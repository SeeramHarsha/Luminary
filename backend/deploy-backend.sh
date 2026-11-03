#!/usr/bin/env bash
# Deploys the Luminary BACKEND (API + video compression) to Cloud Run, with a Cloud Storage bucket for all media and the database.
# Run from the backend/ folder after `gcloud auth login`:
#   PROJECT_ID=my-project BUCKET=my-luminary-media ./deploy-backend.sh
# After the frontend is deployed, run it again with SITE_URL=https://my-project.web.app (or your domain)
# so QR codes use the public address and the bucket accepts direct uploads from that site.
set -euo pipefail

: "${PROJECT_ID:?set PROJECT_ID}"
: "${BUCKET:?set BUCKET (globally unique bucket name)}"
REGION="${REGION:-asia-south1}"
SERVICE="${SERVICE:-luminary-api}"
SA_NAME="${SA_NAME:-luminary-run}"
SITE_URL="${SITE_URL:-}"
SA="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud config set project "$PROJECT_ID"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com storage.googleapis.com

# 1) runtime identity, allowed to touch only this bucket
gcloud iam service-accounts describe "$SA" >/dev/null 2>&1 || gcloud iam service-accounts create "$SA_NAME" --display-name "Luminary Cloud Run"

# 2) the bucket (private; the backend streams files to visitors so QR locks still apply)
gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1 || \
  gcloud storage buckets create "gs://$BUCKET" --location "$REGION" --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member "serviceAccount:$SA" --role roles/storage.objectAdmin >/dev/null

# 3) secrets (created once; reused on later deploys)
if ! gcloud secrets describe luminary-admin-password >/dev/null 2>&1; then
  read -r -s -p "Choose the admin password: " PW; echo
  printf '%s' "$PW" | gcloud secrets create luminary-admin-password --data-file=-
fi
if ! gcloud secrets describe luminary-session-secret >/dev/null 2>&1; then
  openssl rand -hex 32 | tr -d '\n' | gcloud secrets create luminary-session-secret --data-file=-
fi
for s in luminary-admin-password luminary-session-secret; do
  gcloud secrets add-iam-policy-binding "$s" --member "serviceAccount:$SA" --role roles/secretmanager.secretAccessor >/dev/null
done

# 4) deploy.
#  - ONE always-on instance with CPU always allocated: db.json is a single file and ffmpeg runs in the background after an upload
#  - 8Gi memory because Cloud Run's scratch disk is in memory and a raw video is downloaded there while compressing
ENVV="STORAGE=gcs,GCS_BUCKET=$BUCKET,MAX_UPLOAD_MB=2048,TRUST_PROXY=3"
[ -n "$SITE_URL" ] && ENVV="$ENVV,PUBLIC_URL=$SITE_URL"
gcloud run deploy "$SERVICE" --source . --region "$REGION" --service-account "$SA" \
  --allow-unauthenticated --cpu 4 --memory 8Gi --no-cpu-throttling \
  --min-instances 1 --max-instances 1 --timeout 3600 \
  --set-env-vars "$ENVV" \
  --set-secrets "ADMIN_PASSWORD=luminary-admin-password:latest,SESSION_SECRET=luminary-session-secret:latest"

# 5) let the admin's browser upload videos straight into the bucket (needs the frontend's address)
if [ -n "$SITE_URL" ]; then
  sed "s#__ORIGIN__#${SITE_URL}#" cors.json > /tmp/luminary-cors.json
  gcloud storage buckets update "gs://$BUCKET" --cors-file=/tmp/luminary-cors.json
  echo "Bucket CORS + PUBLIC_URL set for $SITE_URL"
else
  echo
  echo "Backend is up: $(gcloud run services describe "$SERVICE" --region "$REGION" --format 'value(status.url)')"
  echo "Next: deploy the frontend (frontend/deploy-frontend.sh), then re-run this script with SITE_URL=<frontend address>."
fi
