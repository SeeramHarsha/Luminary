FROM nginx:1.27-alpine
# BACKEND_URL / BACKEND_HOST are filled in at deploy time, e.g. https://luminary-api-abc123-el.a.run.app and luminary-api-abc123-el.a.run.app
ENV PORT=8080
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY . /usr/share/nginx/html
RUN rm -f /usr/share/nginx/html/Dockerfile /usr/share/nginx/html/nginx.conf.template /usr/share/nginx/html/.dockerignore
