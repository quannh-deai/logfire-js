# Integration Guide

Hướng dẫn tích hợp ứng dụng của bạn với `@pydantic/logfire-viewer`. Viewer
nói chuẩn OTLP, nên **bất kỳ OpenTelemetry SDK nào** (Node, Python, Go, Java,
.NET, Ruby, Rust, PHP, ...) đều gửi dữ liệu thẳng vào được.

---

## 1. Khởi động viewer

### Cách A — Docker Compose (khuyên dùng)

```sh
docker compose -f packages/logfire-viewer/docker-compose.yml up -d --build
docker compose -f packages/logfire-viewer/docker-compose.yml logs viewer
# Token admin in ra stdout đúng MỘT lần — lưu lại ngay.
```

### Cách B — Local install

```sh
npm install -g @pydantic/logfire-viewer
logfire-viewer admin init --data-dir ./logfire-data   # in admin token
logfire-viewer --data-dir ./logfire-data              # start server
```

Khi server chạy, viewer mở 2 cổng:

| Port | Giao thức       | Dùng cho                                    |
|------|-----------------|---------------------------------------------|
| 4318 | HTTP            | OTLP HTTP (proto+JSON), REST API, Web UI    |
| 4317 | gRPC            | OTLP gRPC                                   |

Web UI: <http://localhost:4318>

---

## 2. Tạo project + token

Project = namespace dữ liệu độc lập (mỗi project có DB file riêng).
Token = thông tin xác thực ứng dụng dùng để gửi dữ liệu.

```sh
# Local
logfire-viewer admin add-project demo --data-dir ./logfire-data
logfire-viewer admin add-token --project demo --name my-app --data-dir ./logfire-data
#  → in ra token kiểu lfv_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx (chỉ in 1 lần)

# Docker Compose
docker compose -f packages/logfire-viewer/docker-compose.yml exec viewer \
  node dist/cli.cjs admin add-project demo
docker compose -f packages/logfire-viewer/docker-compose.yml exec viewer \
  node dist/cli.cjs admin add-token --project demo --name my-app
```

Token có 3 scope:
- `write` — gửi spans/logs/metrics
- `read`  — đọc qua REST API + xem trên UI
- `admin` — quản lý projects/tokens

Mặc định token mới có `write,read`. Đổi qua `--scopes write` nếu app chỉ cần ghi.

---

## 3. Tích hợp với SDK trong repo này (`logfire`)

Đây là cách đơn giản nhất nếu bạn dùng Node.js — SDK tự lo OTel.

```sh
npm install logfire
```

```ts
import * as logfire from 'logfire'

logfire.configure({
  serviceName: 'my-service',
  serviceVersion: '1.0.0',
  environment: 'staging',
})

logfire.info('Server started on port {port}', { port: 3000 })

logfire.span('processing-order', { orderId: 'o-42' }, (span) => {
  // ... business logic
  span.end()
})
```

Chỉ cần set 3 biến môi trường:

```sh
export LOGFIRE_TOKEN=lfv_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
export LOGFIRE_SEND_TO_LOGFIRE=true
export LOGFIRE_BASE_URL=http://localhost:4318
node app.js
```

SDK gửi OTLP/protobuf tới `/v1/traces` và `/v1/metrics`. Mở UI → Spans List để
thấy dữ liệu, bấm vào hàng để xem trace tree.

Auto-instrumentation cho `http`, `express`, `fetch`, v.v. tự bật khi gọi
`logfire.configure()` (xem `@opentelemetry/auto-instrumentations-node` trong
`packages/logfire`).

---

## 4. Tích hợp với OpenTelemetry Node SDK thuần

Nếu bạn không muốn dependency `logfire`:

```sh
npm install @opentelemetry/api @opentelemetry/sdk-node \
  @opentelemetry/exporter-trace-otlp-proto \
  @opentelemetry/exporter-logs-otlp-proto \
  @opentelemetry/exporter-metrics-otlp-proto \
  @opentelemetry/auto-instrumentations-node
```

```ts
import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-proto'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto'
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { resourceFromAttributes } from '@opentelemetry/resources'

const TOKEN = process.env.LOGFIRE_TOKEN!
const BASE = process.env.LOGFIRE_BASE_URL ?? 'http://localhost:4318'
const headers = { authorization: TOKEN }

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    'service.name': 'my-service',
    'service.version': '1.0.0',
    'deployment.environment': 'staging',
  }),
  traceExporter: new OTLPTraceExporter({ url: `${BASE}/v1/traces`, headers }),
  logRecordProcessors: [
    /* xem docs: BatchLogRecordProcessor + OTLPLogExporter */
  ],
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({ url: `${BASE}/v1/metrics`, headers }),
    exportIntervalMillis: 10_000,
  }),
  instrumentations: [getNodeAutoInstrumentations()],
})
sdk.start()
```

---

## 5. Tích hợp Browser

Dùng package `@pydantic/logfire-browser` trong repo này hoặc OTel Web SDK
thuần:

```ts
import { configure } from '@pydantic/logfire-browser'

configure({
  serviceName: 'my-spa',
  traceUrl: 'http://localhost:4318/v1/traces',
  // Viewer chấp nhận token qua header Authorization.
  // Browser KHÔNG nên giữ token cứng — proxy qua backend của bạn,
  // hoặc tự host viewer trong cùng origin để dùng cookie.
})
```

Lưu ý CORS: viewer hiện không tự bật CORS. Nếu app frontend ở origin khác,
chạy viewer phía sau reverse proxy thêm header CORS, hoặc deploy chung
domain.

---

## 6. Tích hợp Python

OTel Python gửi thẳng vào được — không cần SDK Logfire Python.

```sh
pip install opentelemetry-sdk \
  opentelemetry-exporter-otlp-proto-http \
  opentelemetry-instrumentation-requests
```

```python
import os
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.resources import Resource
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

token = os.environ["LOGFIRE_TOKEN"]
base = os.environ.get("LOGFIRE_BASE_URL", "http://localhost:4318")

provider = TracerProvider(resource=Resource.create({
    "service.name": "my-python-svc",
    "service.version": "1.0.0",
}))
provider.add_span_processor(BatchSpanProcessor(
    OTLPSpanExporter(endpoint=f"{base}/v1/traces", headers={"authorization": token})
))
trace.set_tracer_provider(provider)

tracer = trace.get_tracer(__name__)
with tracer.start_as_current_span("hello"):
    print("hello from python")
```

Dùng SDK Python Logfire cũng được — set `LOGFIRE_BASE_URL` giống Node.

---

## 7. Tích hợp các ngôn ngữ khác

Bất kỳ OTel SDK (Go, Java, .NET, Ruby, Rust, PHP, Erlang, Swift,...) đều
tích hợp được. Cấu hình chung:

| Setting               | Giá trị                                   |
|-----------------------|-------------------------------------------|
| Endpoint (HTTP)       | `http://localhost:4318`                   |
| Endpoint (gRPC)       | `localhost:4317`                          |
| Protocol              | `http/protobuf` hoặc `http/json` hoặc `grpc` |
| Headers               | `authorization=lfv_xxx...`                |
| Traces path           | `/v1/traces` (HTTP)                       |
| Logs path             | `/v1/logs`   (HTTP)                       |
| Metrics path          | `/v1/metrics` (HTTP)                      |

Ví dụ env vars dùng được với MỌI OTel SDK chính thức:

```sh
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
export OTEL_EXPORTER_OTLP_HEADERS="authorization=lfv_xxx..."
export OTEL_SERVICE_NAME=my-service
export OTEL_RESOURCE_ATTRIBUTES="service.version=1.0.0,deployment.environment=staging"
```

---

## 8. Tích hợp qua OpenTelemetry Collector

Nếu hệ thống đã có Collector ở giữa, point exporter của Collector vào viewer:

```yaml
# otel-collector.yaml
receivers:
  otlp:
    protocols:
      http: {}
      grpc: {}

exporters:
  otlphttp/viewer:
    endpoint: http://logfire-viewer:4318
    headers:
      authorization: lfv_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [otlphttp/viewer]
    logs:
      receivers: [otlp]
      exporters: [otlphttp/viewer]
    metrics:
      receivers: [otlp]
      exporters: [otlphttp/viewer]
```

Một token có thể routing traces, logs, và metrics cùng một project.

---

## 9. Gửi dữ liệu thủ công (curl)

Tiện debug. OTLP/JSON dễ viết tay:

### Trace

```sh
NOW=$(date +%s)000000000
curl -X POST http://localhost:4318/v1/traces \
  -H "authorization: $LOGFIRE_TOKEN" \
  -H "content-type: application/json" \
  -d "{
    \"resourceSpans\": [{
      \"resource\": {\"attributes\": [{\"key\": \"service.name\", \"value\": {\"stringValue\": \"curl\"}}]},
      \"scopeSpans\": [{
        \"scope\": {\"name\": \"manual\"},
        \"spans\": [{
          \"traceId\": \"0123456789abcdef0123456789abcdef\",
          \"spanId\": \"0011223344556677\",
          \"name\": \"hello-from-curl\",
          \"kind\": 1,
          \"startTimeUnixNano\": \"$NOW\",
          \"endTimeUnixNano\": \"$NOW\",
          \"attributes\": [{\"key\": \"logfire.level_num\", \"value\": {\"intValue\": 9}}]
        }]
      }]
    }]
  }"
```

### Log

```sh
NOW=$(date +%s)000000000
curl -X POST http://localhost:4318/v1/logs \
  -H "authorization: $LOGFIRE_TOKEN" \
  -H "content-type: application/json" \
  -d "{
    \"resourceLogs\": [{
      \"resource\": {\"attributes\": [{\"key\": \"service.name\", \"value\": {\"stringValue\": \"curl\"}}]},
      \"scopeLogs\": [{
        \"scope\": {\"name\": \"manual\"},
        \"logRecords\": [{
          \"timeUnixNano\": \"$NOW\",
          \"severityNumber\": 17,
          \"severityText\": \"ERROR\",
          \"body\": {\"stringValue\": \"Something broke\"}
        }]
      }]
    }]
  }"
```

### Metric

```sh
NOW=$(date +%s)000000000
curl -X POST http://localhost:4318/v1/metrics \
  -H "authorization: $LOGFIRE_TOKEN" \
  -H "content-type: application/json" \
  -d "{
    \"resourceMetrics\": [{
      \"resource\": {\"attributes\": [{\"key\": \"service.name\", \"value\": {\"stringValue\": \"curl\"}}]},
      \"scopeMetrics\": [{
        \"scope\": {\"name\": \"manual\"},
        \"metrics\": [{
          \"name\": \"requests_total\",
          \"sum\": {
            \"isMonotonic\": true,
            \"aggregationTemporality\": 2,
            \"dataPoints\": [{
              \"timeUnixNano\": \"$NOW\",
              \"asInt\": \"42\",
              \"attributes\": [{\"key\": \"route\", \"value\": {\"stringValue\": \"/api\"}}]
            }]
          }
        }]
      }]
    }]
  }"
```

---

## 10. Đọc dữ liệu qua API (programmatic)

Tất cả endpoint `/api/*` đều cần header `authorization: <token>` với scope
`read`.

```sh
# Liệt kê spans (filter + FTS)
curl -H "authorization: $TOK" \
  "http://localhost:4318/api/spans?service=my-svc&level=13&q=error&limit=50"

# Xem 1 trace
curl -H "authorization: $TOK" \
  "http://localhost:4318/api/traces/0123456789abcdef0123456789abcdef"

# Aggregations
curl -H "authorization: $TOK" "http://localhost:4318/api/stats"

# Ad-hoc SQL (read-only, SELECT/WITH/EXPLAIN/PRAGMA only)
curl -X POST -H "authorization: $TOK" -H "content-type: application/json" \
  -d '{"sql": "SELECT name, COUNT(*) c FROM spans GROUP BY name ORDER BY c DESC LIMIT 10"}' \
  http://localhost:4318/api/query

# Live tail (Server-Sent Events)
curl -N "http://localhost:4318/api/stream/spans?token=$TOK"
```

---

## 11. Logfire-specific attributes

Viewer hiểu các attribute đặc biệt từ Logfire SDK:

| Attribute               | Mục đích                                            |
|-------------------------|-----------------------------------------------------|
| `logfire.msg`           | Tin nhắn đã format (fallback về `span.name`)        |
| `logfire.level_num`     | Mức log: 1 trace, 5 debug, 9 info, 13 warn, 17 err, 21 fatal |
| `logfire.span_type`     | `span` hoặc `log` hoặc `pending_span`               |
| `logfire.tags`          | Mảng tags (JSON array)                              |
| `logfire.msg_template`  | Template gốc trước khi format                       |

Set chúng từ bất kỳ SDK nào để hiển thị nhất quán với Logfire SDK trong UI.

---

## 12. Cấu hình production (tóm tắt)

| Tình huống                    | Việc cần làm                                  |
|-------------------------------|-----------------------------------------------|
| DB lớn dần vô tận             | `retention_days` / `retention_max_rows` trên project (UI hoặc PATCH `/api/admin/projects/:id`) |
| Một app spam quá tải          | `rate_limit_rps` + `rate_limit_burst` trên project token |
| Giảm dung lượng spans         | `sampling_rate < 1.0` (head sampling theo `trace_id`) |
| Reverse proxy / TLS           | Đặt nginx/Caddy trước viewer; pass-through `/v1/*` + `/api/*` + `/` |
| Backup                        | Copy thư mục `--data-dir` khi server dừng     |
| Multi-tenant                  | 1 project / khách hàng; token riêng từng app  |

---

## 13. Troubleshooting

**`401 Missing Authorization header`** — quên set `LOGFIRE_TOKEN` /
`OTEL_EXPORTER_OTLP_HEADERS`.

**`401 Invalid or revoked token`** — token sai, đã revoke, hoặc bạn đang
dùng admin token cho `/v1/*` (admin chỉ dùng cho `/api/admin/*`).

**`403 Token lacks required scope: write`** — token đó chỉ có scope `read`.
Tạo lại với `--scopes write,read`.

**`429 rate limited`** — chạm `rate_limit_rps` của project hoặc global
`--max-rps`. Header `retry-after` cho biết chờ bao lâu.

**SDK báo "Received Partial Success response"** — đó là response bình
thường của OTLP (`rejectedSpans:0`), không phải lỗi.

**Web UI báo "Web UI not built"** — chỉ xảy ra với chế độ dev. Chạy
`npm run build:web` trong `packages/logfire-viewer/`.

**Spans không hiện trên UI** — kiểm tra:
1. SDK có flush trước khi process exit không (`logfire.shutdown()` / `sdk.shutdown()`).
2. Đúng token cho đúng project (mỗi project có DB riêng).
3. Filter time-range — mặc định "All time" thì luôn thấy.
