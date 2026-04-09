# Use Node.js as the base image
FROM node:20-alpine AS build-stage

# Accept build arguments for Vite environment variables
ARG VITE_DISCORD_CLIENT_ID

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Build the application with the build arg as an environment variable
RUN VITE_DISCORD_CLIENT_ID="${VITE_DISCORD_CLIENT_ID}" npm run build

# Production stage
FROM nginx:stable-alpine AS production-stage

# Copy the built files from the build stage to the nginx server
COPY --from=build-stage /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Runtime config: entrypoint writes config.json from env (e.g. Kubernetes Secret)
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Expose port 80
EXPOSE 80

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]