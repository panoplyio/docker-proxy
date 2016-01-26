# docker-proxy
Create docker containers and proxy HTTP requests to them

```javascript
var proxydocker = require( 'proxy-docker' );
var proxy = proxydocker()

    // define the container create config
    .create({
        Image: 'wordpress',
        ExposedPorts: { '8080/tcp': {} },
        HostConfig: {
            PortBindings: { '8080/tcp': [ { HostPort: '' } ] }
        }
    });

express()
    .get( '/somewhere', function ( req, res ) {
        // intercept requests before the proxying to the container
        res.send( 'Hello world.' );
    })
    .use( function ( req, res, next ) {
        // set a container name for the request.
        // proxy-docker will use it to proxy the request to the 
        // correct container, or create a new one if none exists
        // for that name.
        req.session.container = req.user.name; 
        next()
    })

    // all other requests will be proxied to the container
    .use( proxy.server() );
```
