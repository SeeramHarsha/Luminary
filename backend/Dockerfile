FROM node:20-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
# local-disk mode keeps data in /data; with STORAGE=gcs this is only a scratch folder for ffmpeg
RUN mkdir -p /data && chown -R node:node /data /app
ENV DATA_DIR=/data PORT=3000
USER node
EXPOSE 3000
CMD ["node", "start.js"]
