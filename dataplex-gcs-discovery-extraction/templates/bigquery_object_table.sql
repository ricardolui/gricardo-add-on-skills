-- =============================================================================
-- BigQuery External Object Table DDL for Cloud Storage
-- =============================================================================
-- Exposes raw unstructured files (PDF, XML, EML, CSV, JSON) in GCS to BigQuery SQL
-- without replicating storage. Uses BigQuery Cloud Resource Connection.

CREATE OR REPLACE EXTERNAL TABLE `${PROJECT_ID}.${DATASET_BRONZE}.${TABLE_ID}_object_table`
WITH CONNECTION `${PROJECT_ID}.${CONNECTION_LOCATION}.${CONNECTION_ID}`
OPTIONS (
  object_metadata = 'SIMPLE',
  uris = ['gs://${BUCKET_NAME}/*']
);

-- =============================================================================
-- Verification Query: Check Object Table Metadata
-- =============================================================================
SELECT
  uri,
  size,
  content_type,
  updated,
  md5_hash
FROM `${PROJECT_ID}.${DATASET_BRONZE}.${TABLE_ID}_object_table`
ORDER BY updated DESC
LIMIT 10;
