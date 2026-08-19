# BigQuery Conversational Analytics (Data Agents) API Specification

Service: `geminidataanalytics.googleapis.com`  
Default Version: `v1beta` / `v1`  
Location: `global` (or regional: `us-central1`, `eu`, `us`)

---

## 1. REST Endpoints

### 1.1. Create Data Agent
- **Method**: `POST https://geminidataanalytics.googleapis.com/v1beta/projects/{projectId}/locations/{location}/dataAgents?dataAgentId={dataAgentId}`
- **Headers**:
  - `Authorization: Bearer <GCP_OAUTH_TOKEN>`
  - `Content-Type: application/json`

```json
{
  "name": "projects/{projectId}/locations/{location}/dataAgents/{dataAgentId}",
  "displayName": "Enterprise - Inventory Optimization Specialist",
  "description": "Conversational agent grounded on BigQuery Property Graph",
  "labels": {
    "published_context": "true"
  },
  "dataAnalyticsAgent": {
    "publishedContext": {
      "datasourceReferences": {
        "bq": {
          "propertyGraphReferences": [
            {
              "projectId": "my-project",
              "datasetId": "dataset_gold",
              "propertyGraphId": "enterprise_graph"
            }
          ]
        }
      },
      "systemInstruction": "You are an expert BI analyst...",
      "exampleQueries": [
        {
          "naturalLanguageQuestion": "Qual o spend total faturado por departamento?",
          "sqlQuery": "SELECT department, AGG(total_spend) FROM GRAPH_EXPAND(...) GROUP BY department"
        }
      ]
    },
    "stagingContext": {
      "datasourceReferences": { ... },
      "systemInstruction": "...",
      "exampleQueries": [ ... ]
    }
  }
}
```

### 1.2. Update (Patch) Data Agent
- **Method**: `PATCH https://geminidataanalytics.googleapis.com/v1beta/projects/{projectId}/locations/{location}/dataAgents/{dataAgentId}?updateMask=data_analytics_agent.published_context,data_analytics_agent.staging_context,labels,description,display_name`

### 1.3. Get Data Agent Card (A2A)
- **Method**: `GET https://geminidataanalytics.googleapis.com/v1beta/a2a/projects/{projectId}/locations/{location}/dataAgents/{dataAgentId}/v1/card`

---

## 2. Identifier & Soft-Delete Rules

1. **Max ID Length**: 63 characters, kebab-case (`^[a-z]([a-z0-9-]{0,61}[a-z0-9])?$`).
2. **Naming Convention**: `agent-{company_slug}-{role_slug}-{hash_suffix}`.
3. **Soft-Deletion Grace Period**: Deleting an agent in GCP marks it `SOFT_DELETED` for 30 days. Attempting to recreate an agent with the exact same ID causes `400 FAILED_PRECONDITION`.
4. **Resilience Strategy**:
   - Inspect existing state via `GET /dataAgents/{id}`.
   - If `SOFT_DELETED` is returned, generate a new unique suffix (`Date.now().toString(36)`).
