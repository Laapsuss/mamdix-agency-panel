/**
 * Coolify API Helper
 * Typed functions for all Coolify API calls needed for provisioning.
 * Docs: https://coolify.io/docs/api-reference
 */

const COOLIFY_API_URL = process.env.COOLIFY_API_URL!
const COOLIFY_API_TOKEN = process.env.COOLIFY_API_TOKEN!

const coolifyHeaders = {
    'Authorization': `Bearer ${COOLIFY_API_TOKEN}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
}

export interface CoolifyApplication {
    uuid: string
    name: string
    fqdn: string
}

/**
 * Creates a new Dockerfile-based application in Coolify linked to a GitHub repo.
 * Uses the /applications/dockerfile endpoint with all required fields.
 */
export async function createApplication(payload: {
    projectUuid: string
    serverUuid: string
    environmentUuid: string
    name: string
    githubOwner: string
    repoName: string
    branch: string
    dockerfileLocation: string
    ports: number[]
}): Promise<CoolifyApplication> {
    const body = {
        project_uuid: payload.projectUuid,
        server_uuid: payload.serverUuid,
        environment_uuid: payload.environmentUuid,
        environment_name: 'production',
        github_app_uuid: 'x44cs40gw0cooogcckcok8kc', // UUID de la GitHub App en Coolify
        git_repository: `${payload.githubOwner}/${payload.repoName}`,
        git_branch: payload.branch,
        build_pack: 'dockerfile',
        dockerfile_location: payload.dockerfileLocation,
        name: payload.name,
        ports_exposes: payload.ports.join(','),
        instant_deploy: false,
    }

    const res = await fetch(`${COOLIFY_API_URL}/applications/private-github`, {
        method: 'POST',
        headers: coolifyHeaders,
        body: JSON.stringify(body)
    })

    if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }))
        const errMsg = err?.errors ? JSON.stringify(err.errors) : (err.message || JSON.stringify(err))
        throw new Error(`Coolify createApplication failed: ${errMsg}`)
    }

    const data = await res.json()
    return data
}

/**
 * Sets (bulk upsert) environment variables on a Coolify application.
 */
export async function setEnvironmentVariables(
    appUuid: string,
    envs: Record<string, string>
): Promise<void> {
    const envArray = Object.entries(envs).map(([key, value]) => ({
        key,
        value,
        is_preview: false,
    }))

    const res = await fetch(`${COOLIFY_API_URL}/applications/${appUuid}/envs/bulk`, {
        method: 'POST',
        headers: coolifyHeaders,
        body: JSON.stringify({ data: envArray })
    })

    if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }))
        throw new Error(`Coolify setEnvironmentVariables failed: ${err.message || JSON.stringify(err)}`)
    }
}

/**
 * Sets the domain (FQDN) for a Coolify application.
 */
export async function setDomain(appUuid: string, domain: string): Promise<void> {
    const res = await fetch(`${COOLIFY_API_URL}/applications/${appUuid}`, {
        method: 'PATCH',
        headers: coolifyHeaders,
        body: JSON.stringify({ fqdn: `https://${domain}` })
    })

    if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }))
        throw new Error(`Coolify setDomain failed: ${err.message || JSON.stringify(err)}`)
    }
}

/**
 * Sets the custom Docker options including network alias for internal communication.
 */
export async function setNetworkAlias(appUuid: string, alias: string): Promise<void> {
    const res = await fetch(`${COOLIFY_API_URL}/applications/${appUuid}`, {
        method: 'PATCH',
        headers: coolifyHeaders,
        body: JSON.stringify({
            custom_docker_run_options: `--network-alias ${alias}`
        })
    })

    if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }))
        throw new Error(`Coolify setNetworkAlias failed: ${err.message || JSON.stringify(err)}`)
    }
}

/**
 * Triggers a new deployment for a Coolify application.
 */
export async function triggerDeploy(appUuid: string): Promise<void> {
    const res = await fetch(`${COOLIFY_API_URL}/applications/${appUuid}/deploy`, {
        method: 'POST',
        headers: coolifyHeaders,
    })

    if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }))
        throw new Error(`Coolify triggerDeploy failed: ${err.message || JSON.stringify(err)}`)
    }
}

/**
 * Deletes a Coolify application (used in rollback).
 */
export async function deleteApplication(appUuid: string): Promise<void> {
    await fetch(`${COOLIFY_API_URL}/applications/${appUuid}`, {
        method: 'DELETE',
        headers: coolifyHeaders,
    }).catch(() => console.error(`[Rollback] Failed to delete Coolify app ${appUuid}`))
}
