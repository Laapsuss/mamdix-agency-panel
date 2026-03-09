import { NextResponse } from 'next/server';
import {
    createApplication,
    setEnvironmentVariables,
    setDomain,
    setNetworkAlias,
    triggerDeploy,
    deleteApplication,
} from '@/lib/coolify';

const GITHUB_OWNER = process.env.GITHUB_OWNER || 'Laapsuss';

// ========================
// Rollback Stack
// ========================
type RollbackAction = () => Promise<void>

class RollbackStack {
    private actions: RollbackAction[] = []

    push(action: RollbackAction) {
        this.actions.push(action)
    }

    async execute() {
        console.log('--- INICIANDO PROTOCOLO DE ROLLBACK (AUTO-LIMPIEZA) ---')
        const reversedActions = [...this.actions].reverse()
        for (const action of reversedActions) {
            try {
                await action()
            } catch (err: any) {
                console.error('[Rollback] Fallo en acción de rollback:', err.message)
            }
        }
        console.log('--- ROLLBACK COMPLETADO ---')
    }
}


// ========================
// Helper: Esperar URL de Supabase lista
// ========================
async function waitForSupabase(projectId: string, token: string, maxWait = 90000): Promise<string> {
    const start = Date.now()
    while (Date.now() - start < maxWait) {
        const res = await fetch(`https://api.supabase.com/v1/projects/${projectId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        })
        if (res.ok) {
            const data = await res.json()
            if (data.status === 'ACTIVE_HEALTHY') {
                // Build a final connection string using the transaction/session pooler
                const dbPass = encodeURIComponent('SupabaseMamdix2026!')
                return `postgresql://postgres.${projectId}:${dbPass}@aws-1-eu-west-1.pooler.supabase.com:6543/postgres`
            }
        }
        await new Promise(r => setTimeout(r, 5000))
    }
    throw new Error('Supabase no estuvo listo en el tiempo de espera (90s). Reintenta.')
}


// ========================
// Main POST Handler
// ========================
export async function POST(request: Request) {
    const {
        SUPABASE_ACCESS_TOKEN,
        SUPABASE_ORG_ID,
        GITHUB_TOKEN,
        COOLIFY_API_URL,
        COOLIFY_API_TOKEN,
        COOLIFY_SERVER_UUID,
        COOLIFY_PROJECT_UUID,
        COOLIFY_ENVIRONMENT_UUID,
    } = process.env

    const rollback = new RollbackStack()

    try {
        const body = await request.json()
        const { clientName, slug, baseDomain } = body

        // Validation
        if (!clientName || !slug || !baseDomain) {
            return NextResponse.json(
                { error: 'Faltan parámetros: clientName, slug y baseDomain son obligatorios.' },
                { status: 400 }
            )
        }

        const slugClean = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-')
        const repoBackendName = `${slugClean}-backend`
        const repoStorefrontName = `${slugClean}-storefront`
        const backendDomain = `admin.${baseDomain}`
        const storefrontDomain = `shop.${baseDomain}`
        const backendNetworkAlias = `${slugClean}-backend`

        // Check required secrets
        const missingVars = [
            !SUPABASE_ACCESS_TOKEN && 'SUPABASE_ACCESS_TOKEN',
            !SUPABASE_ORG_ID && 'SUPABASE_ORG_ID',
            !GITHUB_TOKEN && 'GITHUB_TOKEN',
            !COOLIFY_API_URL && 'COOLIFY_API_URL',
            !COOLIFY_API_TOKEN && 'COOLIFY_API_TOKEN',
            !COOLIFY_SERVER_UUID && 'COOLIFY_SERVER_UUID',
            !COOLIFY_PROJECT_UUID && 'COOLIFY_PROJECT_UUID',
            !COOLIFY_ENVIRONMENT_UUID && 'COOLIFY_ENVIRONMENT_UUID',
        ].filter(Boolean)

        if (missingVars.length > 0) {
            throw new Error(`Faltan variables de entorno: ${missingVars.join(', ')}`)
        }

        // ================================================
        // PASO 1: Crear proyecto en Supabase
        // ================================================
        console.log(`[1/9] Creando proyecto Supabase para ${clientName}...`)
        const supabaseRes = await fetch('https://api.supabase.com/v1/projects', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${SUPABASE_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                organization_id: SUPABASE_ORG_ID,
                name: slugClean,
                plan: 'free',
                region: 'eu-west-1',
                db_pass: 'SupabaseMamdix2026!'
            })
        })

        if (!supabaseRes.ok) {
            const err = await supabaseRes.json()
            throw new Error(`Supabase: ${err.message || JSON.stringify(err)}`)
        }

        const supabaseData = await supabaseRes.json()
        const supabaseProjectId = supabaseData.id
        console.log(`   ✅ Proyecto Supabase ${supabaseProjectId} creado.`)

        rollback.push(async () => {
            console.log(`[Rollback] Eliminando proyecto Supabase ${supabaseProjectId}...`)
            const res = await fetch(`https://api.supabase.com/v1/projects/${supabaseProjectId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${SUPABASE_ACCESS_TOKEN}` }
            })
            if (!res.ok) console.error(`[Rollback] Error Supabase: ${res.status}`)
        })

        // ================================================
        // PASO 2: Esperar que Supabase esté listo
        // ================================================
        console.log(`[2/10] Esperando que Supabase esté activo (~30-60s)...`)
        const databaseUrl = await waitForSupabase(supabaseProjectId, SUPABASE_ACCESS_TOKEN!)
        console.log(`   ✅ Supabase activo.`)

        // ================================================
        // PASO 2.5: Obtener API Keys de Supabase y Crear Bucket S3
        // ================================================
        console.log(`[3/10] Configuracion de Supabase Storage S3...`)

        // 1. Obtener API Keys
        const keysRes = await fetch(`https://api.supabase.com/v1/projects/${supabaseProjectId}/api-keys`, {
            headers: { 'Authorization': `Bearer ${SUPABASE_ACCESS_TOKEN}` }
        })
        if (!keysRes.ok) throw new Error(`Error obteniendo API Keys de Supabase: ${await keysRes.text()}`)
        const keys = await keysRes.json()
        const serviceRoleKey = keys.find((k: any) => k.name === 'service_role')?.api_key
        if (!serviceRoleKey) throw new Error('No se encontró la clave service_role en Supabase')

        // 2. Crear Bucket
        const BUCKET_NAME = 'medusa-media'
        const bucketRes = await fetch(`https://${supabaseProjectId}.supabase.co/storage/v1/bucket`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${serviceRoleKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                id: BUCKET_NAME,
                name: BUCKET_NAME,
                public: true, // El bucket debe ser público para que se puedan ver las imágenes
            })
        })
        if (!bucketRes.ok) {
            const errBucket = await bucketRes.json()
            console.warn(`⚠️ Advertencia creando bucket: ${JSON.stringify(errBucket)}`)
        } else {
            console.log(`   ✅ Bucket S3 '${BUCKET_NAME}' creado como público.`)
        }

        const supabaseS3Region = 'eu-west-1'
        const supabaseS3Url = `https://${supabaseProjectId}.supabase.co/storage/v1/s3`
        const supabasePublicUrl = `https://${supabaseProjectId}.supabase.co/storage/v1/object/public/${BUCKET_NAME}`

        // ================================================
        // PASO 3: Clonar repo Backend en GitHub
        // ================================================
        console.log(`[4/10] Clonando repo Backend en GitHub...`)
        const githubResBackend = await fetch(
            `https://api.github.com/repos/${GITHUB_OWNER}/mamdix-core-backend/generate`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${GITHUB_TOKEN}`,
                    'Accept': 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28'
                },
                body: JSON.stringify({
                    owner: GITHUB_OWNER,
                    name: repoBackendName,
                    description: `Motor para ${clientName}`,
                    include_all_branches: false,
                    private: true
                })
            }
        )

        if (!githubResBackend.ok) {
            const err = await githubResBackend.json()
            throw new Error(`GitHub Backend: ${err.message || JSON.stringify(err)}`)
        }

        console.log(`   ✅ Repo ${repoBackendName} creado.`)
        rollback.push(async () => {
            console.log(`[Rollback] Eliminando repo GitHub ${repoBackendName}...`)
            const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${repoBackendName}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${GITHUB_TOKEN}`,
                    'Accept': 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28'
                }
            })
            if (!res.ok) {
                const txt = await res.text()
                console.error(`[Rollback] Error al borrar repo ${repoBackendName}: ${res.status} - ${txt}`)
            } else {
                console.log(`   ✅ Repo ${repoBackendName} borrado de GitHub.`)
            }
        })

        // ================================================
        // PASO 4: Clonar repo Storefront en GitHub
        // ================================================
        console.log(`[5/10] Clonando repo Storefront en GitHub...`)
        const githubResStore = await fetch(
            `https://api.github.com/repos/${GITHUB_OWNER}/mamdix-core-storefront/generate`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${GITHUB_TOKEN}`,
                    'Accept': 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28'
                },
                body: JSON.stringify({
                    owner: GITHUB_OWNER,
                    name: repoStorefrontName,
                    description: `Escaparate para ${clientName}`,
                    include_all_branches: false,
                    private: true
                })
            }
        )

        if (!githubResStore.ok) {
            const err = await githubResStore.json()
            throw new Error(`GitHub Storefront: ${err.message || JSON.stringify(err)}`)
        }

        console.log(`   ✅ Repo ${repoStorefrontName} creado.`)
        rollback.push(async () => {
            console.log(`[Rollback] Eliminando repo GitHub ${repoStorefrontName}...`)
            const res = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${repoStorefrontName}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${GITHUB_TOKEN}`,
                    'Accept': 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28'
                }
            })
            if (!res.ok) {
                const txt = await res.text()
                console.error(`[Rollback] Error al borrar repo ${repoStorefrontName}: ${res.status} - ${txt}`)
            } else {
                console.log(`   ✅ Repo ${repoStorefrontName} borrado de GitHub.`)
            }
        })

        // ================================================
        // PASO 5: Crear servicio Backend en Coolify
        // ================================================
        console.log(`[6/10] Creando servicio Backend en Coolify...`)
        const coolifyBackend = await createApplication({
            projectUuid: COOLIFY_PROJECT_UUID!,
            serverUuid: COOLIFY_SERVER_UUID!,
            environmentUuid: COOLIFY_ENVIRONMENT_UUID!,
            name: `${slugClean}-backend`,
            githubOwner: GITHUB_OWNER,
            repoName: repoBackendName,
            branch: 'main',
            dockerfileLocation: '/Dockerfile',
            ports: [9000],
        })

        const backendUuid = coolifyBackend.uuid
        console.log(`   ✅ Backend Coolify creado (${backendUuid}).`)

        rollback.push(async () => {
            console.log(`[Rollback] Eliminando servicio Coolify Backend ${backendUuid}...`)
            await deleteApplication(backendUuid)
        })

        // ================================================
        // PASO 6: Configurar ENV del Backend en Coolify
        // ================================================
        console.log(`[7/10] Inyectando ENV del Backend en Coolify (Incluyendo S3)...`)
        await setEnvironmentVariables(backendUuid, {
            DATABASE_URL: databaseUrl,
            MEDUSA_BACKEND_URL: `https://${backendDomain}`,
            ADMIN_CORS: `https://${backendDomain}`,
            AUTH_CORS: `https://${backendDomain},https://${storefrontDomain}`,
            STORE_CORS: `https://${storefrontDomain}`,
            JWT_SECRET: crypto.randomUUID(),
            COOKIE_SECRET: crypto.randomUUID(),
            NODE_ENV: 'production',
            // S3 Supabase Storage variables
            S3_URL: supabasePublicUrl,
            S3_BUCKET: BUCKET_NAME,
            S3_REGION: supabaseS3Region,
            S3_ENDPOINT: supabaseS3Url,
            S3_ACCESS_KEY_ID: supabaseProjectId,
            S3_SECRET_ACCESS_KEY: serviceRoleKey,
        })
        console.log(`   ✅ ENV Backend configurado.`)

        // ================================================
        // PASO 7: Configurar Dominio y Network Alias del Backend
        // ================================================
        console.log(`[8/10] Configurando dominio y alias de red del Backend...`)
        await setDomain(backendUuid, backendDomain)
        await setNetworkAlias(backendUuid, backendNetworkAlias)
        console.log(`   ✅ Dominio: ${backendDomain} / Alias: ${backendNetworkAlias}`)

        // ================================================
        // PASO 8: Crear servicio Storefront en Coolify
        // ================================================
        console.log(`[9/10] Creando servicio Storefront en Coolify...`)
        const coolifyStorefront = await createApplication({
            projectUuid: COOLIFY_PROJECT_UUID!,
            serverUuid: COOLIFY_SERVER_UUID!,
            environmentUuid: COOLIFY_ENVIRONMENT_UUID!,
            name: `${slugClean}-storefront`,
            githubOwner: GITHUB_OWNER,
            repoName: repoStorefrontName,
            branch: 'main',
            dockerfileLocation: '/Dockerfile',
            ports: [8000],
        })

        const storefrontUuid = coolifyStorefront.uuid
        console.log(`   ✅ Storefront Coolify creado (${storefrontUuid}).`)

        rollback.push(async () => {
            console.log(`[Rollback] Eliminando servicio Coolify Storefront ${storefrontUuid}...`)
            await deleteApplication(storefrontUuid)
        })

        // ================================================
        // PASO 9: Configurar ENV y Dominio del Storefront
        // ================================================
        console.log(`[10/10] Inyectando ENV del Storefront y configurando dominio...`)

        // We need a publishable key — for now leave a placeholder; it will be filled by user after first backend deploy
        await setEnvironmentVariables(storefrontUuid, {
            MEDUSA_BACKEND_URL: `http://${backendNetworkAlias}:9000`,
            NEXT_PUBLIC_MEDUSA_BACKEND_URL: `https://${backendDomain}`,
            NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY: 'pk_PLACEHOLDER_CONFIGURE_AFTER_FIRST_BACKEND_DEPLOY',
            NEXT_PUBLIC_BASE_URL: `https://${storefrontDomain}`,
            NODE_ENV: 'production',
        })

        await setDomain(storefrontUuid, storefrontDomain)
        console.log(`   ✅ Dominio: ${storefrontDomain}`)

        // ================================================
        // PASO 10: Trigger Deploy de ambos
        // ================================================
        console.log(`[🚀] Disparando deploy de Backend y Storefront...`)
        await triggerDeploy(backendUuid)
        await triggerDeploy(storefrontUuid)
        console.log(`   ✅ Deploys iniciados.`)

        // ================================================
        // SUCCESS
        // ================================================
        return NextResponse.json({
            success: true,
            message: `¡Ecosistema para ${clientName} aprovisionado!`,
            urls: {
                backend_admin: `https://${backendDomain}/app`,
                storefront: `https://${storefrontDomain}`,
            },
            repositories: {
                backend: `https://github.com/${GITHUB_OWNER}/${repoBackendName}`,
                storefront: `https://github.com/${GITHUB_OWNER}/${repoStorefrontName}`,
            },
            notes: [
                '⏳ Los servicios en Coolify tardarán ~5-10 minutos en hacer el primer build.',
                '🔑 Tras el primer deploy del Backend, ve a su Admin (/app) y crea una Publishable API Key.',
                `🔧 Actualiza en Coolify la variable NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY del Storefront con esa key y redeploy.`,
                `🌐 Configura los DNS en tu proveedor: admin.${baseDomain} y shop.${baseDomain} apuntando a la IP de tu servidor.`,
            ]
        })

    } catch (error: any) {
        console.error('\n❌ [Error Crítico]:', error.message)
        await rollback.execute()
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
