# BigQuery Property Graph DDL & MEASURES Best Practices

## 1. Zero-Copy Cross-Project Pointer Architecture

BigQuery Property Graphs do not store physical rows — they compile graph topology dynamically on top of existing SQL table storage.

### Syntax Rules:
1. `CREATE OR REPLACE PROPERTY GRAPH \`target_project.target_dataset.graph_name\`` creates the graph definition in your designated target dataset.
2. In `NODE TABLES` and `EDGE TABLES`, you can directly reference tables residing in:
   - Public datasets: `\`bigquery-public-data.thelook_ecommerce.users\``
   - Cross-project datasets: `\`enterprise-data-lake.gold_procurement.suppliers\``
   - Local project datasets: `\`my-project.analytics.dim_products\``
3. **No Intermediate Views/Tables**: Do NOT execute `CREATE TABLE AS SELECT` or `CREATE VIEW AS SELECT` just to build a graph. Reference the source table directly.

---

## 2. Native Graph MEASURES Specification

BigQuery Property Graphs support declaring computed metrics directly inside the DDL via the `MEASURE` clause:

```sql
MEASURE(<aggregation_expression>) AS <measure_name> OPTIONS(
  description = "<Human and LLM readable explanation of the metric>",
  synonyms = ["<synonym_1>", "<synonym_2>", "<alias>"]
)
```

### Supported Aggregation Functions in MEASURES:
- `SUM(column)`: e.g. `MEASURE(SUM(sale_price)) AS total_gross_revenue`
- `AVG(column)`: e.g. `MEASURE(AVG(retail_price)) AS avg_retail_price`
- `COUNT(column)`: e.g. `MEASURE(COUNT(id)) AS total_entities`
- `MAX(column)`: e.g. `MEASURE(MAX(num_of_item)) AS max_order_size`
- `MIN(column)`: e.g. `MEASURE(MIN(cost)) AS min_unit_cost`

---

## 3. Directional Edges & Multi-Hop Path Rules

Edges represent directional relationships between nodes:
```sql
`dataset.order_items` AS ContainsItemEdge
  SOURCE KEY (order_id) REFERENCES OrderNode (order_id)
  DESTINATION KEY (product_id) REFERENCES Product (id)
  LABEL CONTAINS_ITEM
```

### Multi-Hop GQL Pattern Matching:
To query across 3 or more entities without writing complex chained SQL `JOIN` statements:
```sql
GRAPH `project.dataset.graph`
MATCH (c:Customer)-[:PLACED]->(o:OrderNode)-[:CONTAINS_ITEM]->(p:Product)-[:STOCKED_AT]->(dc:DistributionCenter)
WHERE c.country = 'Brasil'
RETURN
  dc.name AS distribution_center,
  AGG(p.total_products) AS distinct_products_sold,
  AGG(c.total_customers) AS customers_served
ORDER BY distinct_products_sold DESC;
```
