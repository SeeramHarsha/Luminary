FROM nginx:1.27-alpine
# Set BACKEND_URL / BACKEND_HOST on the Cloud Run service (e.g. https://luminary-api-xyz.a.run.app and luminary-api-xyz.a.run.app).
# The defaults only keep nginx from crashing when they are missing: /api then answers 502 instead of the container failing to start.
ENV PORT=8080 \
    BACKEND_URL=http://127.0.0.1:9 \
    BACKEND_HOST=localhost
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY . /usr/share/nginx/html
RUN rm -f /usr/share/nginx/html/Dockerfile /usr/share/nginx/html/nginx.conf.template /usr/share/nginx/html/.dockerignore
