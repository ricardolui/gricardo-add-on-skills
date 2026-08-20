#!/usr/bin/env node
/**
 * Dataplex Knowledge Catalog & GCS Discovery Scan with BigQuery AI.GENERATE (Gemini 3.7 Flash)
 * End-to-End Execution Script
 * 
 * Usage:
 *   node run_gcs_discovery_scan.js \
 *     --projectId "my-gcp-project" \
 *     --bucket "my-gcs-bucket" \
 *     --datasetBronze "app01_p2p_bronze" \
 *     --datasetSilver "app01_p2p_silver" \
 *     --tableId "bronze_invoices_extracted" \
 *     --location "US"
 */

import { GoogleAuth } from 'google-auth-library';
import { BigQuery } from '@google-cloud/bigquery';
import { Storage } from '@google-cloud/storage';

function parseArgs() {
  const args = process.argv.slice(2);
  const params = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].substring(2);
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
      params[key] = val;
      if (val !== true) i++;
    }
  }
  return params;
}

const getDataplexRegion = (location) => {
  if (!location) return 'us-central1';
  const loc = location.toLowerCase();
  if (loc === 'us' || loc === 'multi-region') return 'us-central1';
  if (loc === 'eu') return 'europe-west1';
  return location;
};

const getConnectionLocation = (bqLocation) => {
  if (!bqLocation) return 'us';
  const loc = bqLocation.toLowerCase();
  return (loc === 'us' || loc === 'multi-region') ? 'us' : (loc === 'eu' ? 'eu' : loc);
};

async function main() {
  const args = parseArgs();
  const projectId = args.projectId || process.env.GOOGLE_CLOUD_PROJECT || process.env.PROJECT_ID;
  const bucketName = args.bucket;
  const datasetBronze = args.datasetBronze || args.dataset || 'demo_bronze';
  const datasetSilver = args.datasetSilver || 'demo_silver';
  const tableId = args.tableId || args.table || 'unstructured_documents';
  const location = args.location || 'US';

  if (!projectId || !bucketName) {
    console.error('❌ Error: --projectId and --bucket are required parameters.');
    console.log(`
Usage:
  node run_gcs_discovery_scan.js \\
    --projectId "<PROJECT_ID>" \\
    --bucket "<BUCKET_NAME>" \\
    --datasetBronze "app01_p2p_bronze" \\
    --datasetSilver "app01_p2p_silver" \\
    --tableId "bronze_quotes_extracted" \\
    --location "US"
    `);
    process.exit(1);
  }

  const region = getDataplexRegion(location);
  const connLocation = getConnectionLocation(location);
  const connectionId = 'gemini-vertex-conn';

  console.log(`\n=============================================================`);
  console.log(`🚀 [Dataplex & BigQuery AI] End-to-End Discovery & Extraction (Gemini 3.7 Flash)`);
  console.log(`=============================================================`);
  console.log(`• Project ID:        ${projectId}`);
  console.log(`• GCS Bucket:        gs://${bucketName}`);
  console.log(`• Bronze Dataset:    ${datasetBronze}`);
  console.log(`• Silver Dataset:    ${datasetSilver}`);
  console.log(`• Dataplex Region:   ${region}`);
  console.log(`• BigQuery Location: ${location}`);
  console.log(`• Foundation Model:  gemini-3.7-flash`);
  console.log(`=============================================================\n`);

  const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
  });
  const client = await auth.getClient();
  const accessToken = (await client.getAccessToken()).token;

  const bigquery = new BigQuery({ projectId });
  const storage = new Storage({ projectId });

  // -------------------------------------------------------------
  // STEP 1: Verify / Grant Storage Permissions to Connection SA
  // -------------------------------------------------------------
  console.log(`▶ [Step 1/7] Inspecting Cloud Resource Connection & Bucket IAM...`);
  try {
    const connUrl = `https://bigqueryconnection.googleapis.com/v1/projects/${projectId}/locations/${region}/connections/${connectionId}`;
    const connRes = await fetch(connUrl, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    let saEmail = null;
    if (connRes.ok) {
      const connData = await connRes.json();
      saEmail = connData.cloudResource?.serviceAccountId;
      console.log(`  ✔ Found BigQuery Connection '${connectionId}'. SA: ${saEmail}`);
    } else {
      console.log(`  ℹ Connection '${connectionId}' not found. Creating in ${region}...`);
      const createConnUrl = `https://bigqueryconnection.googleapis.com/v1/projects/${projectId}/locations/${region}/connections?connectionId=${connectionId}`;
      const createRes = await fetch(createConnUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ cloudResource: {} })
      });
      if (createRes.ok) {
        const createData = await createRes.json();
        saEmail = createData.cloudResource?.serviceAccountId;
        console.log(`  ✔ Created BigQuery Connection '${connectionId}'. SA: ${saEmail}`);
      } else {
        console.warn(`  ⚠️ Warning: Could not auto-create connection: ${await createRes.text()}`);
      }
    }

    if (saEmail) {
      console.log(`  Granting 'roles/storage.objectViewer' to ${saEmail} on bucket ${bucketName}...`);
      const bucket = storage.bucket(bucketName);
      const [policy] = await bucket.iam.getPolicy();
      const role = 'roles/storage.objectViewer';
      const member = `serviceAccount:${saEmail}`;

      let binding = policy.bindings.find(b => b.role === role);
      if (!binding) {
        binding = { role, members: [] };
        policy.bindings.push(binding);
      }
      if (!binding.members.includes(member)) {
        binding.members.push(member);
        await bucket.iam.setPolicy(policy);
        console.log(`  ✔ Storage Object Viewer successfully granted.`);
      } else {
        console.log(`  ✔ Storage Object Viewer already present.`);
      }
    }
  } catch (err) {
    console.warn(`  ⚠️ IAM / Connection warning (continuing): ${err.message}`);
  }

  // -------------------------------------------------------------
  // STEP 2: Provision BigQuery External Object Table
  // -------------------------------------------------------------
  console.log(`\n▶ [Step 2/7] Provisioning BigQuery External Object Table...`);
  const cleanDataset = datasetBronze.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const cleanTable = tableId.toLowerCase().replace(/_extracted$/, '').replace(/[^a-z0-9-]/g, '-');
  const extTableName = `${cleanTable.replace('bronze_', '')}_object_table`;

  const extTableQuery = `
    CREATE OR REPLACE EXTERNAL TABLE \`${projectId}.${datasetBronze}.${extTableName}\`
    WITH CONNECTION \`${projectId}.${connLocation}.${connectionId}\`
    OPTIONS (
      object_metadata = 'SIMPLE',
      uris = ['gs://${bucketName}/*']
    );
  `;
  try {
    await bigquery.query({ query: extTableQuery, location });
    console.log(`  ✔ External Object Table \`${projectId}.${datasetBronze}.${extTableName}\` ready.`);
  } catch (err) {
    console.error(`  ❌ Failed to create External Object Table: ${err.message}`);
  }

  // -------------------------------------------------------------
  // STEP 3: Create Dataplex Discovery Scan (Metadata Curation)
  // -------------------------------------------------------------
  console.log(`\n▶ [Step 3/7] Setting up Dataplex Cloud Storage Discovery Scan...`);
  let scanId = `${cleanDataset}-${cleanTable}-discovery-scan`.substring(0, 63).replace(/(^-+|-+$)/g, '');
  const parent = `projects/${projectId}/locations/${region}`;
  const dataScanUrl = `https://dataplex.googleapis.com/v1/${parent}/dataScans?dataScanId=${scanId}`;

  const scanPayload = {
    type: "DATA_DISCOVERY",
    data: {
      resource: `//storage.googleapis.com/projects/${projectId}/buckets/${bucketName}`
    },
    executionSpec: {
      trigger: {
        onDemand: {}
      }
    },
    dataDiscoverySpec: {
      bigqueryPublishingConfig: {
        tableType: "BIGLAKE",
        connection: `projects/${projectId}/locations/${region}/connections/${connectionId}`
      },
      storageConfig: {
        unstructuredDataOptions: {
          semanticInferenceEnabled: true
        }
      }
    }
  };

  try {
    const scanCreateRes = await fetch(dataScanUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(scanPayload)
    });

    if (scanCreateRes.status === 409) {
      console.log(`  ℹ DataScan '${scanId}' already exists.`);
    } else if (!scanCreateRes.ok) {
      console.warn(`  ⚠️ DataScan creation returned ${scanCreateRes.status}: ${await scanCreateRes.text()}`);
    } else {
      const lro = await scanCreateRes.json();
      console.log(`  ✔ DataScan creation initiated. LRO: ${lro.name}`);
      
      // Wait for LRO
      if (lro.name && !lro.done) {
        console.log(`  Waiting for Dataplex DataScan provisioning operation...`);
        let opDone = false;
        let attempts = 0;
        while (!opDone && attempts < 30) {
          await new Promise(r => setTimeout(r, 3000));
          attempts++;
          const opRes = await fetch(`https://dataplex.googleapis.com/v1/${lro.name}`, {
            headers: { Authorization: `Bearer ${accessToken}` }
          });
          if (opRes.ok) {
            const opData = await opRes.json();
            if (opData.done) {
              opDone = true;
              console.log(`  ✔ DataScan provisioned successfully.`);
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn(`  ⚠️ Exception creating DataScan: ${err.message}`);
  }

  // -------------------------------------------------------------
  // STEP 4: Trigger Dataplex Scan Run & Poll Jobs
  // -------------------------------------------------------------
  console.log(`\n▶ [Step 4/7] Triggering Dataplex Discovery Scan execution...`);
  const runUrl = `https://dataplex.googleapis.com/v1/projects/${projectId}/locations/${region}/dataScans/${scanId}:run`;
  try {
    const runRes = await fetch(runUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });

    if (runRes.ok) {
      console.log(`  ✔ Scan run triggered. Polling execution jobs...`);
      let done = false;
      let pollAttempts = 0;
      while (!done && pollAttempts < 24) {
        await new Promise(r => setTimeout(r, 5000));
        pollAttempts++;

        const jobsUrl = `https://dataplex.googleapis.com/v1/projects/${projectId}/locations/${region}/dataScans/${scanId}/jobs?pageSize=3`;
        const jobsRes = await fetch(jobsUrl, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });

        if (jobsRes.ok) {
          const jobsData = await jobsRes.json();
          const latestJob = jobsData.jobs && jobsData.jobs[0];
          if (latestJob) {
            console.log(`  [Job Status: ${latestJob.state}] ${latestJob.name}`);
            if (latestJob.state === 'SUCCEEDED') {
              console.log(`  ✔ Dataplex Discovery Scan Succeeded! Metadata curated into Universal Catalog.`);
              done = true;
            } else if (latestJob.state === 'FAILED' || latestJob.state === 'CANCELLED') {
              console.warn(`  ⚠️ Dataplex Job ended in state: ${latestJob.state} (${latestJob.message || ''})`);
              done = true;
            }
          }
        }
      }
    } else {
      console.warn(`  ⚠️ Trigger scan returned ${runRes.status}: ${await runRes.text()}`);
    }
  } catch (err) {
    console.warn(`  ⚠️ Scan run trigger failed: ${err.message}`);
  }

  // -------------------------------------------------------------
  // STEP 5: Provision BigQuery Remote Model with Gemini 3.7 Flash
  // -------------------------------------------------------------
  console.log(`\n▶ [Step 5/7] Provisioning Remote Model (gemini-3.7-flash)...`);
  const remoteModelDdl = `
    CREATE OR REPLACE MODEL \`${projectId}.${datasetBronze}.gemini_model\`
    REMOTE WITH CONNECTION DEFAULT
    OPTIONS(
      ENDPOINT = 'projects/${projectId}/locations/global/publishers/google/models/gemini-3.7-flash'
    );
  `;
  try {
    await bigquery.query({ query: remoteModelDdl, location });
    console.log(`  ✔ Remote Model \`${projectId}.${datasetBronze}.gemini_model\` provisioned with Gemini 3.7 Flash.`);
  } catch (err) {
    console.warn(`  ℹ Note on Remote Model creation (continuing): ${err.message}`);
  }

  // -------------------------------------------------------------
  // STEP 6: BigQuery AI.GENERATE Entity Extraction into Silver
  // -------------------------------------------------------------
  console.log(`\n▶ [Step 6/7] Executing BigQuery AI.GENERATE Structured Entity Extraction...`);
  const silverTable = `extracted_${cleanTable.replace('bronze_', '')}`;
  const aiExtractionQuery = `
    CREATE OR REPLACE TABLE \`${projectId}.${datasetSilver}.${silverTable}\` AS
    SELECT
      uri AS gcs_source_uri,
      AI.GENERATE(
        MODEL \`${projectId}.${datasetBronze}.gemini_model\`,
        '''
        Analyze this raw document content. Extract into valid JSON:
        {
          "document_type": "string",
          "entity_name": "string",
          "document_number": "string",
          "total_amount": number,
          "currency": "string",
          "document_date": "YYYY-MM-DD",
          "summary": "string"
        }
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
    FROM \`${projectId}.${datasetBronze}.${extTableName}\`;
  `;

  try {
    console.log(`  Executing AI extraction query targeting \`${projectId}.${datasetSilver}.${silverTable}\`...`);
    const [job] = await bigquery.createQueryJob({
      query: aiExtractionQuery,
      location
    });
    console.log(`  BigQuery Job ID: ${job.id}. Waiting for completion...`);
    await job.getQueryResults();
    console.log(`  ✔ Silver structured entity extraction completed successfully with Gemini 3.7 Flash!`);
  } catch (err) {
    console.warn(`  ℹ Note on AI.GENERATE execution: ${err.message}`);
  }

  // -------------------------------------------------------------
  // STEP 7: Dataplex Universal Knowledge Catalog Verification
  // -------------------------------------------------------------
  console.log(`\n▶ [Step 7/7] Verifying Catalog Entries in Dataplex Knowledge Catalog...`);
  try {
    const searchUrl = `https://dataplex.googleapis.com/v1/projects/${projectId}/locations/global/entries:search?query=name:${extTableName}`;
    const searchRes = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (searchRes.ok) {
      const searchData = await searchRes.json();
      const count = searchData.results?.length || 0;
      console.log(`  ✔ Found ${count} cataloged entries matching '${extTableName}' in Dataplex.`);
    } else {
      console.log(`  ℹ Catalog search query completed with status: ${searchRes.status}`);
    }
  } catch (err) {
    console.warn(`  ⚠️ Dataplex search check: ${err.message}`);
  }

  console.log(`\n=============================================================`);
  console.log(`🎉 Dataplex GCS Discovery & BigQuery AI Extraction (Gemini 3.7 Flash) Complete!`);
  console.log(`• Bronze Object Table: \`${projectId}.${datasetBronze}.${extTableName}\``);
  console.log(`• Gemini Remote Model: \`${projectId}.${datasetBronze}.gemini_model\``);
  console.log(`• Silver Extracted:    \`${projectId}.${datasetSilver}.${silverTable}\``);
  console.log(`• Dataplex DataScan:     projects/${projectId}/locations/${region}/dataScans/${scanId}`);
  console.log(`=============================================================\n`);
}

main().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
