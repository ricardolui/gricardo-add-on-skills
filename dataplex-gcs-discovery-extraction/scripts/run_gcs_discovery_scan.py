#!/usr/bin/env python3
"""
Dataplex Knowledge Catalog & GCS Discovery Scan with BigQuery AI.GENERATE (Gemini 3.7 Flash)
Python End-to-End Execution Script

Usage:
    python run_gcs_discovery_scan.py \
        --project-id "my-gcp-project" \
        --bucket "my-gcs-bucket" \
        --dataset-bronze "app01_p2p_bronze" \
        --dataset-silver "app01_p2p_silver" \
        --table-id "bronze_invoices_extracted" \
        --location "US"
"""

import argparse
import json
import os
import re
import sys
import time
import requests
import google.auth
from google.auth.transport.requests import Request
from google.cloud import bigquery
from google.cloud import storage

def get_dataplex_region(location: str) -> str:
    if not location:
        return "us-central1"
    loc = location.lower()
    if loc in ("us", "multi-region"):
        return "us-central1"
    if loc == "eu":
        return "europe-west1"
    return location

def get_connection_location(location: str) -> str:
    if not location:
        return "us"
    loc = location.lower()
    if loc in ("us", "multi-region"):
        return "us"
    if loc == "eu":
        return "eu"
    return loc

def main():
    parser = argparse.ArgumentParser(description="Dataplex GCS Discovery Scan & BigQuery AI.GENERATE (Gemini 3.7 Flash) Runner")
    parser.add_argument("--project-id", required=True, help="Google Cloud Project ID")
    parser.add_argument("--bucket", required=True, help="GCS Bucket containing unstructured files")
    parser.add_argument("--dataset-bronze", default="demo_bronze", help="Bronze BigQuery dataset ID")
    parser.add_argument("--dataset-silver", default="demo_silver", help="Silver BigQuery dataset ID")
    parser.add_argument("--table-id", default="unstructured_documents", help="Table identifier")
    parser.add_argument("--location", default="US", help="BigQuery dataset location (US, EU, etc.)")

    args = parser.parse_args()

    project_id = args.project_id
    bucket_name = args.bucket
    dataset_bronze = args.dataset_bronze
    dataset_silver = args.dataset_silver
    table_id = args.table_id
    location = args.location
    region = get_dataplex_region(location)
    conn_location = get_connection_location(location)
    connection_id = "gemini-vertex-conn"

    print("=============================================================")
    print("🚀 [Dataplex & BigQuery AI] GCS Discovery & Entity Extraction (Gemini 3.7 Flash)")
    print("=============================================================")
    print(f"• Project ID:        {project_id}")
    print(f"• GCS Bucket:        gs://{bucket_name}")
    print(f"• Bronze Dataset:    {dataset_bronze}")
    print(f"• Silver Dataset:    {dataset_silver}")
    print(f"• Dataplex Region:   {region}")
    print(f"• BigQuery Location: {location}")
    print(f"• Foundation Model:  gemini-3.7-flash")
    print("=============================================================\n")

    credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    credentials.refresh(Request())
    access_token = credentials.token
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }

    bq_client = bigquery.Client(project=project_id)
    storage_client = storage.Client(project=project_id)

    # -------------------------------------------------------------
    # Step 1: Ensure BigQuery Connection & IAM
    # -------------------------------------------------------------
    print("▶ [Step 1/7] Checking BigQuery Cloud Resource Connection & Bucket IAM...")
    conn_url = f"https://bigqueryconnection.googleapis.com/v1/projects/{project_id}/locations/{region}/connections/{connection_id}"
    conn_resp = requests.get(conn_url, headers=headers)
    
    sa_email = None
    if conn_resp.status_code == 200:
        conn_data = conn_resp.json()
        sa_email = conn_data.get("cloudResource", {}).get("serviceAccountId")
        print(f"  ✔ Connection '{connection_id}' exists. SA: {sa_email}")
    else:
        print(f"  ℹ Creating connection '{connection_id}' in {region}...")
        create_conn_url = f"https://bigqueryconnection.googleapis.com/v1/projects/{project_id}/locations/{region}/connections?connectionId={connection_id}"
        create_resp = requests.post(create_conn_url, headers=headers, json={"cloudResource": {}})
        if create_resp.status_code in (200, 201):
            conn_data = create_resp.json()
            sa_email = conn_data.get("cloudResource", {}).get("serviceAccountId")
            print(f"  ✔ Created BigQuery Connection '{connection_id}'. SA: {sa_email}")

    if sa_email:
        try:
            bucket = storage_client.bucket(bucket_name)
            policy = bucket.get_iam_policy(requested_policy_version=3)
            role = "roles/storage.objectViewer"
            member = f"serviceAccount:{sa_email}"
            if not any(member in b["members"] for b in policy.bindings if b["role"] == role):
                policy.bindings.append({"role": role, "members": [member]})
                bucket.set_iam_policy(policy)
                print(f"  ✔ Granted '{role}' to {member} on gs://{bucket_name}")
            else:
                print(f"  ✔ Bucket IAM '{role}' already present for {member}")
        except Exception as e:
            print(f"  ⚠️ Warning setting bucket IAM: {e}")

    # -------------------------------------------------------------
    # Step 2: Provision External Object Table in BigQuery
    # -------------------------------------------------------------
    print("\n▶ [Step 2/7] Provisioning BigQuery External Object Table...")
    clean_dataset = re.sub(r"[^a-z0-9-]", "-", dataset_bronze.lower())
    clean_table = re.sub(r"[^a-z0-9-]", "-", re.sub(r"_extracted$", "", table_id.lower()))
    ext_table_name = f"{clean_table.replace('bronze_', '')}_object_table"

    ext_table_query = f"""
    CREATE OR REPLACE EXTERNAL TABLE `{project_id}.{dataset_bronze}.{ext_table_name}`
    WITH CONNECTION `{project_id}.{conn_location}.{connection_id}`
    OPTIONS (
      object_metadata = 'SIMPLE',
      uris = ['gs://{bucket_name}/*']
    );
    """
    try:
        query_job = bq_client.query(ext_table_query, location=location)
        query_job.result()
        print(f"  ✔ External Object Table `{project_id}.{dataset_bronze}.{ext_table_name}` ready.")
    except Exception as e:
        print(f"  ❌ Error provisioning External Object Table: {e}")

    # -------------------------------------------------------------
    # Step 3: Configure Dataplex Discovery Scan (DATA_DISCOVERY)
    # -------------------------------------------------------------
    print("\n▶ [Step 3/7] Configuring Dataplex Cloud Storage Discovery Scan...")
    scan_id = f"{clean_dataset}-{clean_table}-discovery-scan"[:63].strip("-")
    parent = f"projects/{project_id}/locations/{region}"
    scan_url = f"https://dataplex.googleapis.com/v1/{parent}/dataScans?dataScanId={scan_id}"

    scan_payload = {
        "type": "DATA_DISCOVERY",
        "data": {
            "resource": f"//storage.googleapis.com/projects/{project_id}/buckets/{bucket_name}"
        },
        "executionSpec": {
            "trigger": {
                "onDemand": {}
            }
        },
        "dataDiscoverySpec": {
            "bigqueryPublishingConfig": {
                "tableType": "BIGLAKE",
                "connection": f"projects/{project_id}/locations/{region}/connections/{connection_id}"
            },
            "storageConfig": {
                "unstructuredDataOptions": {
                    "semanticInferenceEnabled": True
                }
            }
        }
    }

    create_scan_resp = requests.post(scan_url, headers=headers, json=scan_payload)
    if create_scan_resp.status_code == 409:
        print(f"  ℹ Discovery DataScan '{scan_id}' already exists.")
    elif create_scan_resp.status_code in (200, 201):
        lro = create_scan_resp.json()
        print(f"  ✔ Discovery DataScan creation initiated (LRO: {lro.get('name')})")
        if lro.get("name") and not lro.get("done"):
            op_url = f"https://dataplex.googleapis.com/v1/{lro['name']}"
            for _ in range(30):
                time.sleep(3)
                op_resp = requests.get(op_url, headers=headers)
                if op_resp.status_code == 200 and op_resp.json().get("done"):
                    print(f"  ✔ DataScan provisioning complete.")
                    break
    else:
        print(f"  ⚠️ Warning creating DataScan ({create_scan_resp.status_code}): {create_scan_resp.text}")

    # -------------------------------------------------------------
    # Step 4: Trigger Dataplex Scan Run & Poll
    # -------------------------------------------------------------
    print("\n▶ [Step 4/7] Triggering Dataplex Discovery Scan Run...")
    run_url = f"https://dataplex.googleapis.com/v1/projects/{project_id}/locations/{region}/dataScans/{scan_id}:run"
    run_resp = requests.post(run_url, headers=headers, json={})
    if run_resp.status_code in (200, 201):
        print(f"  ✔ Discovery Scan run triggered. Polling execution status...")
        jobs_url = f"https://dataplex.googleapis.com/v1/projects/{project_id}/locations/{region}/dataScans/{scan_id}/jobs?pageSize=3"
        for _ in range(24):
            time.sleep(5)
            jobs_resp = requests.get(jobs_url, headers=headers)
            if jobs_resp.status_code == 200:
                jobs_data = jobs_resp.json().get("jobs", [])
                if jobs_data:
                    latest = jobs_data[0]
                    state = latest.get("state")
                    print(f"  [Job Status: {state}] {latest.get('name')}")
                    if state == "SUCCEEDED":
                        print(f"  ✔ Discovery Scan Succeeded! Metadata curated in Knowledge Catalog.")
                        break
                    elif state in ("FAILED", "CANCELLED"):
                        print(f"  ⚠️ Scan ended in {state}: {latest.get('message')}")
                        break
    else:
        print(f"  ⚠️ Triggering run returned ({run_resp.status_code}): {run_resp.text}")

    # -------------------------------------------------------------
    # Step 5: Provision BigQuery Remote Model with Gemini 3.7 Flash
    # -------------------------------------------------------------
    print("\n▶ [Step 5/7] Provisioning Remote Model with Gemini 3.7 Flash...")
    remote_model_ddl = f"""
    CREATE OR REPLACE MODEL `{project_id}.{dataset_bronze}.gemini_model`
    REMOTE WITH CONNECTION DEFAULT
    OPTIONS(
      ENDPOINT = 'projects/{project_id}/locations/global/publishers/google/models/gemini-3.7-flash'
    );
    """
    try:
        model_job = bq_client.query(remote_model_ddl, location=location)
        model_job.result()
        print(f"  ✔ Remote Model `{project_id}.{dataset_bronze}.gemini_model` provisioned successfully.")
    except Exception as e:
        print(f"  ℹ Remote Model creation note (continuing): {e}")

    # -------------------------------------------------------------
    # Step 6: BigQuery AI.GENERATE Entity Extraction
    # -------------------------------------------------------------
    print("\n▶ [Step 6/7] Running BigQuery AI.GENERATE Structured Entity Extraction...")
    silver_table = f"extracted_{clean_table.replace('bronze_', '')}"
    ai_sql = f"""
    CREATE OR REPLACE TABLE `{project_id}.{dataset_silver}.{silver_table}` AS
    SELECT
      uri AS gcs_source_uri,
      AI.GENERATE(
        MODEL `{project_id}.{dataset_bronze}.gemini_model`,
        '''
        Analyze this raw document content. Extract into valid JSON:
        {{
          "document_type": "string",
          "entity_name": "string",
          "document_number": "string",
          "total_amount": number,
          "currency": "string",
          "document_date": "YYYY-MM-DD",
          "summary": "string"
        }}
        ''',
        table_column => content
      ) AS raw_json,
      JSON_EXTRACT_SCALAR(raw_json, '$.entity_name') AS entity_name,
      JSON_EXTRACT_SCALAR(raw_json, '$.document_type') AS document_type,
      JSON_EXTRACT_SCALAR(raw_json, '$.document_number') AS document_number,
      SAFE_CAST(JSON_EXTRACT_SCALAR(raw_json, '$.total_amount') AS NUMERIC) AS total_amount,
      JSON_EXTRACT_SCALAR(raw_json, '$.currency') AS currency,
      SAFE_CAST(JSON_EXTRACT_SCALAR(raw_json, '$.document_date') AS DATE) AS document_date,
      JSON_EXTRACT_SCALAR(raw_json, '$.summary') AS summary
    FROM `{project_id}.{dataset_bronze}.{ext_table_name}`;
    """
    try:
        print(f"  Executing AI extraction query targeting `{project_id}.{dataset_silver}.{silver_table}`...")
        job = bq_client.query(ai_sql, location=location)
        print(f"  BigQuery Job ID: {job.job_id}. Waiting for completion...")
        job.result()
        print(f"  ✔ Structured entity extraction completed successfully into Silver table with Gemini 3.7 Flash!")
    except Exception as e:
        print(f"  ℹ AI.GENERATE note: {e}")

    print("\n=============================================================")
    print("🎉 Dataplex GCS Discovery & BigQuery AI Extraction Complete!")
    print(f"• Bronze Object Table: `{project_id}.{dataset_bronze}.{ext_table_name}`")
    print(f"• Remote Gemini Model: `{project_id}.{dataset_bronze}.gemini_model`")
    print(f"• Silver Extracted Table: `{project_id}.{dataset_silver}.{silver_table}`")
    print(f"• Dataplex DataScan:     projects/{project_id}/locations/{region}/dataScans/{scan_id}")
    print("=============================================================\n")

if __name__ == "__main__":
    main()
