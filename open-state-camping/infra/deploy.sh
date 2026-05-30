#!/usr/bin/env bash
#
# Deploy the read-only public preview to Azure Container Apps.
#
# Reviewable, idempotent, two-phase:
#   1. Provision infra (ACR, environment, identity, app with a placeholder image).
#   2. Build + push the real image to the new ACR, then redeploy the app to use it.
#
# Prerequisites:
#   - az CLI logged in (az login) with rights to create resources in the target RG.
#   - The 'containerapp' extension (the script installs/updates it).
#   - Run from the project dir (open-state-camping/) so the Docker context is '.'.
#
# Nothing here writes a secret to disk or to the repo. The app pulls from ACR via a
# managed identity, not a registry password.
#
# Usage:
#   RESOURCE_GROUP=rg-open-state-preview LOCATION=canadacentral ./infra/deploy.sh
set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:-rg-open-state-preview}"
LOCATION="${LOCATION:-canadacentral}"
NAME_PREFIX="${NAME_PREFIX:-openstate}"
IMAGE_TAG="${IMAGE_TAG:-$(git rev-parse --short HEAD 2>/dev/null || echo latest)}"
IMAGE_REPO="open-state-camping"
BICEP="$(dirname "$0")/main.bicep"

echo "==> Resource group: $RESOURCE_GROUP  Region: $LOCATION  Tag: $IMAGE_TAG"

az extension add --name containerapp --upgrade --only-show-errors 1>/dev/null
az provider register --namespace Microsoft.App --only-show-errors 1>/dev/null
az provider register --namespace Microsoft.OperationalInsights --only-show-errors 1>/dev/null

echo "==> Ensuring resource group exists"
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --only-show-errors 1>/dev/null

# Phase 1: provision infra (placeholder image; creates the ACR we push to).
echo "==> Phase 1: provisioning infrastructure (placeholder image)"
az deployment group create \
  --resource-group "$RESOURCE_GROUP" \
  --template-file "$BICEP" \
  --parameters location="$LOCATION" namePrefix="$NAME_PREFIX" \
  --only-show-errors 1>/dev/null

ACR_NAME="$(az deployment group show -g "$RESOURCE_GROUP" -n main --query properties.outputs.acrName.value -o tsv)"
ACR_LOGIN="$(az deployment group show -g "$RESOURCE_GROUP" -n main --query properties.outputs.acrLoginServer.value -o tsv)"
FULL_IMAGE="${ACR_LOGIN}/${IMAGE_REPO}:${IMAGE_TAG}"
echo "    ACR: $ACR_LOGIN"

# Phase 2: build the image in ACR (no local Docker needed) and redeploy with it.
echo "==> Phase 2: building image in ACR: $FULL_IMAGE"
az acr build \
  --registry "$ACR_NAME" \
  --image "${IMAGE_REPO}:${IMAGE_TAG}" \
  --file Dockerfile . \
  --only-show-errors 1>/dev/null

echo "==> Redeploying app to use the built image"
az deployment group create \
  --resource-group "$RESOURCE_GROUP" \
  --template-file "$BICEP" \
  --parameters location="$LOCATION" namePrefix="$NAME_PREFIX" containerImage="$FULL_IMAGE" \
  --only-show-errors 1>/dev/null

APP_URL="$(az deployment group show -g "$RESOURCE_GROUP" -n main --query properties.outputs.appUrl.value -o tsv)"
MCP_URL="$(az deployment group show -g "$RESOURCE_GROUP" -n main --query properties.outputs.mcpEndpoint.value -o tsv)"

echo
echo "==> Done."
echo "    Public URL:   $APP_URL"
echo "    Health:       $APP_URL/health"
echo "    MCP endpoint: $MCP_URL"
echo
echo "Verify, then add $MCP_URL as a custom connector in Claude (no auth)."
