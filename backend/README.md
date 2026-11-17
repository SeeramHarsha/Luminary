# Luminary backend

Express API and QR access rules. Deployed to Cloud Run (build from `backend/Dockerfile`).
Photos, cover images and the database live in a Google Cloud Storage bucket. Videos are played from YouTube (the admin pastes a link), so the server handles no video files.

## Variables
- `GCS_BUCKET=<bucket name>` (only the name, no `gs://`)
- `ADMIN_PASSWORD` (first start only), `TRUST_PROXY=3`, `PUBLIC_URL=<frontend address>`

## Bucket setup
- Run the service as a service account with **Storage Object Admin** on the bucket
- 1 CPU / 1 GiB is enough, CPU always allocated, max instances 1 (the database is a single file)
- No bucket CORS is needed (nothing is uploaded from the browser directly to the bucket)

Without `GCS_BUCKET` the backend stores everything on local disk (development).

## SMS to the teachers (any SMS provider with an HTTP API)
Admin > Calendar > Message teacher can send the teacher a short SMS ("Send SMS now"), Today's messages can send to every school ("Send SMS to all teachers now"), and an optional automatic morning SMS can be switched on. Nothing is sent unless an admin confirms, or the automatic time is set. Works with Fast2SMS, MSG91, Twilio, Telinfy and others: you describe the provider's "send SMS" request with the settings below.

**Before you start (India):** every SMS must use a template approved on DLT. In Admin > Settings > SMS to teachers Luminary shows the exact template text to register (it looks like `Hello {#var#}, today's Luminary topics for {#var#}: {#var#}. Open {#var#} School code {#var#}`). Register it with your provider together with your sender ID (header) and entity ID, and note the **template ID**. The link must be on the allowed-URL list of your DLT account.

**Settings** (Cloud Run backend service > environment variables):

| Variable | Meaning |
| :--- | :--- |
| `SMS_API_URL` | The send address of the provider. Turns SMS on. May contain placeholders |
| `SMS_API_METHOD` | `POST` (default) or `GET` |
| `SMS_API_FORMAT` | `json` (default) or `form`: how the body is sent |
| `SMS_API_BODY` | Body template, for example `{"to":"{{phone}}","message":"{{message}}","sender":"{{sender}}","template_id":"{{template_id}}"}` |
| `SMS_API_HEADERS` | Headers as JSON, for example `{"Authorization":"Bearer {{apikey}}"}` |
| `SMS_API_KEY`, `SMS_SENDER`, `SMS_TEMPLATE_ID`, `SMS_ENTITY_ID`, `SMS_ROUTE` | Values for the placeholders of the same name |
| `SMS_SUCCESS_MATCH` | Optional: text that must appear in the provider's answer for a send to count as successful, or a regular expression between slashes, e.g. `/"return"\s*:\s*true/` |
| `SMS_DEFAULT_COUNTRY` | Country code added to 10-digit numbers (default `91`) |
| `SMS_TEXT` | Optional SMS wording; placeholders `{name} {school} {date} {topics} {count} {link} {code}`. It must match the DLT template |
| `SMS_TOPICS_MAX` | Maximum length of the topics part (default 110 characters) |
| `SMS_AUTO_TIME` | Optional, `07:30`: sends the morning SMS automatically every day (within 3 hours after that time, once per day) |
| `SMS_TZ_OFFSET` | Minutes from UTC for `SMS_AUTO_TIME` and "today" (default `330`, India) |
| `SMS_AUTO_SKIP_SUNDAY` | `true` (default) or `false` |

Placeholders usable in the URL, body and headers: `{{phone}}` (digits with country code), `{{phone10}}`, `{{phone_plus}}`, `{{message}}` (the full text), `{{sender}}`, `{{apikey}}`, `{{template_id}}`, `{{entity_id}}`, `{{route}}`, and for providers that take a template ID plus the variable values instead of the full text: `{{values_pipe}}` (a|b|c), `{{values_json}}`, `{{v1}}` `{{v2}}` ... Values are escaped for the place they are used (address, JSON or form).

### Example: Fast2SMS (DLT route, from its public documentation)
```
SMS_API_URL     = https://www.fast2sms.com/dev/bulkV2?route=dlt&sender_id={{sender}}&message={{template_id}}&variables_values={{values_pipe}}&numbers={{phone10}}
SMS_API_METHOD  = GET
SMS_API_HEADERS = {"Authorization":"{{apikey}}"}
SMS_API_KEY     = (your Fast2SMS API key)
SMS_SENDER      = (your DLT sender ID, 3 to 6 letters)
SMS_TEMPLATE_ID = (the message ID of your approved template)
SMS_SUCCESS_MATCH = /"return"\s*:\s*true/
```
For another provider (MSG91, Twilio, Telinfy ...) copy the request from that provider's "send SMS" API sample into the same settings.

Then open Admin > Settings > SMS to teachers and press **Send a test SMS** with your own number. Keep the backend at **1 instance with CPU always allocated** (needed for the automatic morning SMS). The log of recent sends (numbers masked) is in the same card. The API key is never shown in the app.
