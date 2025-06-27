# Use the official Puppeteer image which includes all necessary dependencies.
FROM ghcr.io/puppeteer/puppeteer:22.12.1

# Set the working directory in the container
WORKDIR /usr/src/app

# Switch to root temporarily to handle file permissions and installations
USER root

# Copy package files and install dependencies as root
# This avoids all permission issues during the build process
COPY package*.json ./
RUN npm install

# Copy the rest of the application source code
COPY . .

# Change ownership of the entire application directory to the non-root user
RUN chown -R pptruser:pptruser /usr/src/app

# Switch back to the non-root user for running the application
USER pptruser

# Expose the port the app runs on
EXPOSE 7113

# Define the command to run the app
CMD [ "node", "server.js" ] 