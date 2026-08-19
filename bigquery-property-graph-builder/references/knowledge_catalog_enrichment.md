# Dataplex Knowledge Catalog Semantic Layer & Business Glossary Integration

## 1. Overview & Role in Conversational Analytics

**Dataplex Knowledge Catalog** is the centralized metadata, governance, and business glossary service in Google Cloud. When BigQuery Conversational Agents (`geminidataanalytics.googleapis.com`) receive queries in natural language, they consult Knowledge Catalog to:
1. Disambiguate business acronyms (e.g. `UPT`, `CMV`, `GMV`, `Churn`).
2. Identify synonyms and localized business terms (e.g. `cliente` $\leftrightarrow$ `user`, `faturamento` $\leftrightarrow$ `gross_revenue`).
3. Apply access control and data classification tags.

---

## 2. Business Glossary Structure

Create a Business Glossary in Dataplex Knowledge Catalog for the domain:

### Key Glossary Terms & Mapping to Graph:
| Business Term | Display Name | Definition | Graph Element / MEASURE Mapping |
| :--- | :--- | :--- | :--- |
| **Gross Revenue** | Faturamento Bruto | Valor total faturado dos itens vendidos excluindo cancelamentos | `ContainsItemEdge.total_gross_revenue` (`MEASURE(SUM(sale_price))`) |
| **Units Per Transaction (UPT)** | Itens por Pedido | Média de produtos comprados em um único pedido | `OrderNode.avg_items_per_order` (`MEASURE(AVG(num_of_item))`) |
| **Average Ticket** | Ticket Médio de Pedido | Valor médio faturado por pedido | `OrderNode.total_gross_revenue / OrderNode.total_orders` |
| **IP Collision Ring** | Anel de Colisão de IP | Endereço IP compartilhado por 3 ou mais clientes distintos | `WebEvent.ip_address` com `COUNT(DISTINCT user_id) >= 3` |
| **Customer Churn Risk** | Risco de Churn | Clientes com 3+ compras históricas mas sem compras nos últimos 180 dias | `Customer` sem aresta `PLACED` nos últimos 180 dias |

---

## 3. Metadata Tagging Standard

Create a Dataplex Tag Template: `semantic_layer_tag`
- **Fields**:
  - `is_semantic_entity` (BOOL)
  - `entity_role` (ENUM: `NODE`, `EDGE`, `MEASURE`, `DIMENSION`)
  - `canonical_measure_name` (STRING)
  - `business_unit` (STRING)
  - `data_quality_tier` (ENUM: `GOLD`, `SILVER`, `BRONZE`)

### Applying Tags via gcloud / BigQuery:
```bash
# Tagging a BigQuery table with semantic metadata
gcloud dataplex entries update ...
```
All column descriptions and synonyms set in `CREATE OR REPLACE PROPERTY GRAPH` are automatically indexed and searchable by Dataplex Knowledge Catalog and Gemini in BigQuery!
