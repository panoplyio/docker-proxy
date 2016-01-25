var extend = require( 'extend' );
var express = require( 'express' );
var Docker = require( 'dockerode' );
var Promise = require( 'bluebird' );
var debug = require( 'debug' )( 'proxy-docker' );
var proxy = require( 'http-proxy' ).createProxyServer();

module.exports = function ( docker ) {
    return new DockerProxy( docker );
}

function DockerProxy ( docker ) {
    if ( !docker ) {
        docker = new Docker();
    }

    this._docker = Promise.promisifyAll( docker );
    this._docker.getContainerAsync = function () {
        var container = this.getContainer.apply( this, arguments );
        container = Promise.promisifyAll( container );
        return Promise.resolve( container );
    }

    this._autoCreate = false;
    this._readyfn = function () {
        return Promise.resolve( true );
    }
}

DockerProxy.prototype.ready = function ( readyfn ) {
    this._readyfn = readyfn;
    return this;
}

DockerProxy.prototype.autoCreate = function ( enabled ) {
    this._autoCreate = enabled;
    return this;
}

DockerProxy.prototype.findContainer = function ( name ) {
    return findContainer( this, name );
}

DockerProxy.prototype.create = function ( createfn ) {
    if ( typeof createfn === 'object' ) {
        var createConf = createfn;
        createfn = function ( docker, name ) {
            var conf = extend( {}, createConf, { name: name } );
            return docker.createContainerAsync( conf )
        }
    }

    this._createfn = createfn;
    return this;
}

DockerProxy.prototype.server = function () {
    return express()
        .use( function ( req, res, next ) {
            var name = req.session.container;
            if ( !name ) {
                debug( 'No container name found in session' );
                next();
                return;
            }

            Promise.resolve()
                .bind( this )

                // find the container by name
                .then( function () {
                    debug( 'Looking up container: %s', name );
                    return this.findContainer( name )
                })

                // make sure it exists, or create it.
                .then( function ( container ) {
                    if ( container ) {
                        return container;
                    } else if ( !this._autoCreate ) {
                        throw new Error( 'No container found: ' + name + ' (autoCreate: false)' );
                    } else if ( !this._createfn ) {
                        throw new Error( 'No container found: ' + name + ' (missing create function)' );
                    }

                    // container doesn't exist, create it.
                    debug( 'Container not found: %s. Creating...', name );
                    return this._createfn( this._docker, name )
                        .return({ Status: '' }) // wasn't started
                })

                // make sure it's running, or start it.
                .then( function ( container ) {
                    if ( container.Status.indexOf( 'Up ' ) === 0 ) {
                        return container; // container already running
                    }

                    // not running, start it up...
                    debug( 'Container not running: %s. Starting...', name );
                    return this._docker.getContainerAsync( name )
                        .bind( this )
                        .then( function ( container ) {
                            return container.startAsync();
                        })
                        .then( function () {
                            // need to re-read the container info after
                            // starting it because the port may have changed
                            return this.findContainer( name )
                        })
                })
                .then( function ( container ) {
                    var port = container.Ports[ 0 ].PublicPort;
                    var target = 'http://127.0.0.1:' + port;
                    var options = { target: target };
                    debug( 'Proxy to container: %s, at %s', name, target );
                    return new Promise( function ( resolve, reject ) {
                        proxy.web( req, res, options, function ( err ) {
                            if ( err ) {
                                reject( err )
                            } else {
                                resolve();
                            }
                        })
                    })
                    .catch( ConnectionResetError, function () {
                        debug( 'Container connection reset or not ready: %s. Initializing...', name );
                        res.send([
                            'Initializing...',
                            '<script>',
                            '   setTimeout(function(){',
                            '       window.location.reload()',
                            '   },1000)',
                            '</script>'
                        ].join( '' ) )
                    }) 
                })

                .catch( function ( err ) {
                    log( err, err.stack );
                    res.status( 500 ).send( err.toString() )
                })
        }.bind( this ) )
}

function findContainer ( proxy, name ) {
    return proxy._docker.listContainersAsync({ all: true })
        .filter( function ( container ) {
            return container.Names[ 0 ] === '/' + name;
        })
        .get( 0 )
        .tap( function ( container ) {
            if ( container ) {
                var port = container.Ports[ 0 ].PublicPort;
                container.target = '127.0.0.1:' + port
            }
        })
}

function ConnectionResetError ( err ) {
    return err.code === 'ECONNRESET';
}



