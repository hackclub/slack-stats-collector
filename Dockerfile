FROM node:5-onbuild

# Install nodemon for reloading of code
RUN npm install -g nodemon

EXPOSE 3000
