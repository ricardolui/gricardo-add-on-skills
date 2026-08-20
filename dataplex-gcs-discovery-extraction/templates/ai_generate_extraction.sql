-- =============================================================================
-- Step 1: Provision BigQuery Remote Model (Gemini 3.7 Flash)
-- =============================================================================
CREATE OR REPLACE MODEL `${PROJECT_ID}.${DATASET_BRONZE}.gemini_model`
REMOTE WITH CONNECTION DEFAULT
OPTIONS(
  ENDPOINT = 'projects/${PROJECT_ID}/locations/global/publishers/google/models/gemini-3.7-flash'
);

-- =============================================================================
-- Step 2: BigQuery AI.GENERATE Structured Entity Extraction
-- =============================================================================
-- Reads unstructured content directly from the Bronze Object Table,
-- uses Gemini 3.7 Flash via BigQuery SQL AI.GENERATE, and produces
-- clean, strongly typed dimensional attributes in the Silver Lakehouse dataset.

CREATE OR REPLACE TABLE `${PROJECT_ID}.${DATASET_SILVER}.extracted_${ENTITY_NAME}` AS
WITH raw_extractions AS (
  SELECT
    uri AS gcs_source_uri,
    content,
    updated AS ingestion_timestamp,
    AI.GENERATE(
      MODEL `${PROJECT_ID}.${DATASET_BRONZE}.gemini_model`,
      '''
      Analyze this raw business document (e.g., supplier quote, invoice, receipt, legal contract).
      Extract and output strictly valid JSON conforming to this schema:
      {
        "document_type": "string (e.g. INVOICE, QUOTE, CONTRACT, RECEIPT)",
        "entity_name": "string (Supplier, Vendor, or Customer name)",
        "document_number": "string (Invoice #, PO #, Quote ID)",
        "document_date": "YYYY-MM-DD",
        "due_date": "YYYY-MM-DD",
        "currency": "string (ISO-4217, e.g. USD, BRL, EUR)",
        "subtotal_amount": number,
        "tax_amount": number,
        "freight_amount": number,
        "total_amount": number,
        "payment_terms_days": integer,
        "summary": "string (concise 1-sentence summary)",
        "confidence_score": number (0.0 to 1.0)
      }
      Do not include markdown code block backticks. Output valid JSON only.
      ''',
      table_column => content
    ) AS extracted_json_text
  FROM `${PROJECT_ID}.${DATASET_BRONZE}.${TABLE_ID}_object_table`
)
SELECT
  gcs_source_uri,
  ingestion_timestamp,
  extracted_json_text AS raw_json,
  JSON_EXTRACT_SCALAR(extracted_json_text, '$.document_type') AS document_type,
  JSON_EXTRACT_SCALAR(extracted_json_text, '$.entity_name') AS entity_name,
  JSON_EXTRACT_SCALAR(extracted_json_text, '$.document_number') AS document_number,
  SAFE_CAST(JSON_EXTRACT_SCALAR(extracted_json_text, '$.document_date') AS DATE) AS document_date,
  SAFE_CAST(JSON_EXTRACT_SCALAR(extracted_json_text, '$.due_date') AS DATE) AS due_date,
  JSON_EXTRACT_SCALAR(extracted_json_text, '$.currency') AS currency,
  SAFE_CAST(JSON_EXTRACT_SCALAR(extracted_json_text, '$.subtotal_amount') AS NUMERIC) AS subtotal_amount,
  SAFE_CAST(JSON_EXTRACT_SCALAR(extracted_json_text, '$.tax_amount') AS NUMERIC) AS tax_amount,
  SAFE_CAST(JSON_EXTRACT_SCALAR(extracted_json_text, '$.freight_amount') AS NUMERIC) AS freight_amount,
  SAFE_CAST(JSON_EXTRACT_SCALAR(extracted_json_text, '$.total_amount') AS NUMERIC) AS total_amount,
  SAFE_CAST(JSON_EXTRACT_SCALAR(extracted_json_text, '$.payment_terms_days') AS INT64) AS payment_terms_days,
  JSON_EXTRACT_SCALAR(extracted_json_text, '$.summary') AS summary,
  SAFE_CAST(JSON_EXTRACT_SCALAR(extracted_json_text, '$.confidence_score') AS FLOAT64) AS confidence_score
FROM raw_extractions;
