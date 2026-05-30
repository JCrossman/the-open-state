// Azure infrastructure for the read-only public preview (docs/m2-validation-findings.md,
// decision 2 / option A). Provisions a scale-to-zero Azure Container App that serves
// the public-data, prepare-only MCP tools over Streamable HTTP, with the alert tools
// and poller disabled.
//
// Security posture:
// - The Container App pulls its image from ACR via a user-assigned managed identity
//   (AcrPull role), so no registry admin password is created or stored.
// - HTTPS is terminated at the Container Apps ingress (allowInsecure: false).
// - No secrets in this template. Government credentials never touch this service
//   (Constitution Art. 1); the preview exposes only read-only, prepare-only tools.
//
// Deploy at resource-group scope (see deploy.sh).

targetScope = 'resourceGroup'

@description('Azure region. Canada Central matches the data-residency intent in the M2 spec.')
param location string = resourceGroup().location

@description('Short name stem for resources. Lowercase letters and numbers.')
@minLength(3)
@maxLength(16)
param namePrefix string = 'openstate'

@description('Container image reference in the ACR, e.g. <acr>.azurecr.io/open-state-camping:<tag>. Empty on first pass deploys a placeholder so the image can be pushed, then redeploy.')
param containerImage string = ''

@description('Requests per second for the global rate limit (upstream politeness, Art. 7.3).')
param rateLimitRps string = '5'

@description('Burst capacity for the global rate limit.')
param rateLimitBurst string = '20'

@description('Max replicas. Min is fixed at 0 so the preview scales to zero when idle.')
@minValue(1)
@maxValue(10)
param maxReplicas int = 3

var uniqueSuffix = uniqueString(resourceGroup().id)
var acrName = toLower('${namePrefix}acr${uniqueSuffix}')
var envName = '${namePrefix}-env'
var appName = '${namePrefix}-camping'
var logName = '${namePrefix}-logs'
var identityName = '${namePrefix}-pull-id'
// Hello-world placeholder until the real image is built and pushed (see deploy.sh).
var placeholderImage = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
var effectiveImage = empty(containerImage) ? placeholderImage : containerImage
var targetPort = 8000

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    // Keep the cheap default retention; this is a low-volume preview.
    retentionInDays: 30
  }
}

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  sku: {
    name: 'Basic'
  }
  properties: {
    // No admin user: pulls go through the managed identity below.
    adminUserEnabled: false
  }
}

resource pullIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: identityName
  location: location
}

// Built-in AcrPull role.
var acrPullRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')

resource acrPullAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, pullIdentity.id, acrPullRoleId)
  scope: acr
  properties: {
    roleDefinitionId: acrPullRoleId
    principalId: pullIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource environment 'Microsoft.App/managedEnvironments@2025-01-01' = {
  name: envName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

resource containerApp 'Microsoft.App/containerApps@2025-01-01' = {
  name: appName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${pullIdentity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      // Pull from ACR using the user-assigned identity; no registry password.
      registries: empty(containerImage) ? [] : [
        {
          server: acr.properties.loginServer
          identity: pullIdentity.id
        }
      ]
      ingress: {
        external: true
        targetPort: targetPort
        transport: 'auto'
        allowInsecure: false
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      }
    }
    template: {
      containers: [
        {
          name: appName
          image: effectiveImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            { name: 'OPEN_STATE_TRANSPORT', value: 'http' }
            { name: 'OPEN_STATE_HOST', value: '0.0.0.0' }
            { name: 'OPEN_STATE_PORT', value: string(targetPort) }
            { name: 'OPEN_STATE_MCP_PATH', value: '/mcp' }
            // Read-only public preview: alert tools hidden, poller off.
            { name: 'OPEN_STATE_ENABLE_ALERTS', value: 'false' }
            { name: 'OPEN_STATE_RATE_LIMIT_RPS', value: rateLimitRps }
            { name: 'OPEN_STATE_RATE_LIMIT_BURST', value: rateLimitBurst }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: targetPort
              }
              initialDelaySeconds: 5
              periodSeconds: 30
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/health'
                port: targetPort
              }
              initialDelaySeconds: 3
              periodSeconds: 10
            }
          ]
        }
      ]
      scale: {
        // Scale to zero: with the poller off there is nothing to keep warm, so
        // an idle preview costs (almost) nothing. A request cold-starts it.
        minReplicas: 0
        maxReplicas: maxReplicas
        rules: [
          {
            name: 'http-scaling'
            http: {
              metadata: {
                concurrentRequests: '20'
              }
            }
          }
        ]
      }
    }
  }
}

@description('The public HTTPS URL of the preview. MCP endpoint is <fqdn>/mcp.')
output appUrl string = 'https://${containerApp.properties.configuration.ingress.fqdn}'

@description('MCP endpoint to add as a custom connector.')
output mcpEndpoint string = 'https://${containerApp.properties.configuration.ingress.fqdn}/mcp'

@description('Login server of the created ACR, for building/pushing the image.')
output acrLoginServer string = acr.properties.loginServer

@description('Name of the created ACR.')
output acrName string = acr.name
