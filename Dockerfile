FROM node:5

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

# Install build-essential for compiling native dependencies
RUN apt-get update
RUN apt-get install -y build-essential

# Install npm dependencies (we move the installed dependencies to /tmp then
# back so we don't delete our node_modules folder when we copy the current
# directory over
COPY package.json /usr/src/app/
RUN npm install
RUN npm install -g nodemon # Install nodemon for optional reloading of code
# Installing from the package.json with `npm install` doesn't properly
# recompile the native binary needed
RUN npm install nodegit
COPY . /usr/src/app

EXPOSE 3000

CMD [ "npm", "start" ]
