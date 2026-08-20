# Dataplex Knowledge Catalog & DataScan REST API Cheatsheet (Gemini 3.7 Flash)

Complete reference guide for interacting with Dataplex DataScans, Universal Catalog, and BigLake Discovery APIs.

---

## 1. REST Endpoints Overview

| Operation | Method | REST Endpoint |
| :--- | :--- | :--- |
| **Create DataScan** | `POST` | `https://dataplex.googleapis.com/v1/projects/{project}/locations/{region}/dataScans?dataScanId={id}` |
| **Get DataScan** | `GET` | `https://dataplex.googleapis.com/v1/projects/{project}/locations/{region}/dataScans/{id}` |
| **Run DataScan** | `POST` | `https://dataplex.googleapis.com/v1/projects/{project}/locations/{region}/dataScans/{id}:run` |
| **List Jobs** | `GET` | `https://dataplex.googleapis.com/v1/projects/{project}/locations/{region}/dataScans/{id}/jobs?pageSize={size}` |
| **Get Job Details** | `GET` | `https://dataplex.googleapis.com/v1/projects/{project}/locations/{region}/dataScans/{id}/jobs/{jobId}` |
| **Check LRO** | `GET` | `https://dataplex.googleapis.com/v1/{operationName}` |
| **Search Catalog** | `POST` | `https://dataplex.googleapis.com/v1/projects/{project}/locations/global/entries:search` |

---

## 2. BigQuery Remote Model with Gemini 3.7 Flash DDL

```sql
CREATE OR REPLACE MODEL `${PROJECT_ID}.${DATASET_BRONZE}.gemini_model`
REMOTE WITH CONNECTION DEFAULT
OPTIONS(
  ENDPOINT = 'projects/${PROJECT_ID}/locations/global/publishers/google/models/gemini-3.7-flash'
);
```

---

## 3. API Request & Response Details

### A. Creating a `DATA_DISCOVERY` Scan
```bash
curl -X POST \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  "https://dataplex.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/dataScans?dataScanId=${SCAN_ID}" \
  -d '{
    "type": "DATA_DISCOVERY",
    "data": {
      "resource": "//storage.googleapis.com/projects/'"${PROJECT_ID}"'/buckets/'"${BUCKET_NAME}"'"
    },
    "executionSpec": {
      "trigger": { "onDemand": {} }
    },
    "dataDiscoverySpec": {
      "bigqueryPublishingConfig": {
        "tableType": "BIGLAKE",
        "connection": "projects/'"${PROJECT_ID}"'/locations/'"${REGION}"'/connections/gemini-vertex-conn"
      },
      "storageConfig": {
        "unstructuredDataOptions": {
          "semanticInferenceEnabled": true
        }
      }
    }
  }'
```

### B. Triggering an On-Demand Run
```bash
curl -X POST \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  "https://dataplex.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/dataScans/${SCAN_ID}:run" \
  -d '{}'
```

### C. Polling Job Execution Status
```bash
curl -X GET \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://dataplex.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/dataScans/${SCAN_ID}/jobs?pageSize=5"
```

---

## 4. gcloud CLI Reference

### A. Discovery & Search
```bash
# Semantic Natural Language Search
gcloud dataplex entries search "unstructured invoices and supplier quotes" \
  --project="${PROJECT_ID}" \
  --semantic-search \
  --limit=25

# Keyword lookup by system & type
gcloud dataplex entries search "type=TABLE system=BIGQUERY" \
  --project="${PROJECT_ID}" \
  --limit=50
```

### B. BigQuery Connection Management
```bash
# Create Cloud Resource Connection
bq mk --connection \
  --location=us-central1 \
  --project_id="${PROJECT_ID}" \
  --connection_type=CLOUD_RESOURCE \
  gemini-vertex-conn

# Describe Connection & Get SA Email
bq show --connection "${PROJECT_ID}.us-central1.gemini-vertex-conn"
```

---

## 5. Key Error Codes & Solutions

| Error | Cause | Resolution |
| :--- | :--- | :--- |
| `400 Bad Request` on `/jobs` | Scan is in `CREATING` state | Check scan state first; only poll `/jobs` once `state !== 'CREATING'`. |
| `403 Permission Denied` | BigQuery Connection SA missing bucket access | Grant `roles/storage.objectViewer` on `gs://bucket` to the Connection SA. |
| `409 Already Exists` | DataScan ID was already created | Non-fatal. Ignore 409 and proceed to trigger `:run`. |
| `Location Mismatch` | Dataset in `US` but Connection in `us-east4` | Co-locate connection (`us-central1` or `us`) and dataset. |
