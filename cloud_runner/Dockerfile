# Use the official Puppeteer image which includes all necessary dependencies.
FROM ghcr.io/puppeteer/puppeteer:22.12.1

# As root, create a directory for the app and give the non-root user ownership.
USER root
RUN mkdir -p /usr/src/app && chown -R pptruser:pptruser /usr/src/app

# Switch back to the non-root user for security
USER pptruser

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install app dependencies
RUN npm install

# Copy app source code
COPY . .

# Expose the port the app runs on
EXPOSE 7113

# Define the command to run the app
CMD [ "node", "server.js" ] 