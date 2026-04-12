// Cache-Aside Pattern: Redis como caché entre result y PostgreSQL.
// Flujo: request → check Redis → (HIT) devolver cache
//                              → (MISS) query PostgreSQL → guardar en Redis → devolver

var express = require('express'),
  async = require('async'),
  pg = require('pg'),
  Redis = require('ioredis'),
  path = require('path'),
  cookieParser = require('cookie-parser'),
  methodOverride = require('method-override'),
  app = express(),
  server = require('http').Server(app),
  io = require('socket.io')(server, {
    transports: ['polling']
  });

var port = process.env.PORT || 4000;
var CACHE_KEY = 'vote:scores';
var CACHE_TTL_SECONDS = 5;

// --- Redis (Cache-Aside) ---
var redis = new Redis({
  host: process.env.REDIS_HOST || 'redis',
  port: process.env.REDIS_PORT || 6379,
  retryStrategy: function (times) {
    var delay = Math.min(times * 500, 5000);
    console.log('[cache] Retrying Redis connection in ' + delay + 'ms...');
    return delay;
  }
});

redis.on('connect', function () {
  console.log('[cache] Connected to Redis');
});

redis.on('error', function (err) {
  console.error('[cache] Redis error:', err.message);
});

// --- WebSocket ---
io.sockets.on('connection', function (socket) {
  socket.emit('message', { text: 'Welcome!' });
  socket.on('subscribe', function (data) {
    socket.join(data.channel);
  });
});

// --- PostgreSQL ---
var pool = new pg.Pool({
  connectionString: 'postgres://okteto:okteto@postgresql/votes',
});

async.retry(
  { times: 1000, interval: 1000 },
  function (callback) {
    pool.connect(function (err, client, done) {
      if (err) {
        console.error('[db] Waiting for db', err.message);
      }
      callback(err, client);
    });
  },
  function (err, client) {
    if (err) {
      console.error('[db] Giving up connecting to PostgreSQL');
      return;
    }
    console.log('[db] Connected to PostgreSQL');
    getVotes(client);
  }
);

// Cache-Aside: checa Redis primero, si no está va a PostgreSQL
function getVotes(client) {
  redis.get(CACHE_KEY, function (cacheErr, cachedValue) {
    if (!cacheErr && cachedValue) {
      // CACHE HIT: devuelve los datos cacheados sin tocar la DB
      console.log('[cache] HIT — serving scores from Redis');
      io.sockets.emit('scores', cachedValue);
      scheduleNext(client);
      return;
    }

    // CACHE MISS: consulta PostgreSQL y guarda en Redis
    console.log('[cache] MISS — querying PostgreSQL');
    client.query(
      'SELECT vote, COUNT(id) AS count FROM votes GROUP BY vote',
      [],
      function (err, result) {
        if (err) {
          console.error('[db] Error performing query: ' + err);
          scheduleNext(client);
          return;
        }

        var votes = collectVotesFromResult(result);
        var json = JSON.stringify(votes);

        // Guardar en Redis con TTL
        redis.setex(CACHE_KEY, CACHE_TTL_SECONDS, json, function (setErr) {
          if (setErr) {
            console.error('[cache] Error storing in Redis:', setErr.message);
          } else {
            console.log('[cache] Stored scores in Redis (TTL=' + CACHE_TTL_SECONDS + 's)');
          }
        });

        io.sockets.emit('scores', json);
        scheduleNext(client);
      }
    );
  });
}

function scheduleNext(client) {
  setTimeout(function () {
    getVotes(client);
  }, 1000);
}

function collectVotesFromResult(result) {
  var votes = { a: 0, b: 0 };
  result.rows.forEach(function (row) {
    votes[row.vote] = parseInt(row.count);
  });
  return votes;
}

app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride('X-HTTP-Method-Override'));
app.use(function (req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'PUT, GET, POST, DELETE, OPTIONS');
  next();
});

app.use(express.static(__dirname + '/views'));

app.get('/', function (req, res) {
  res.sendFile(path.resolve(__dirname + '/views/index.html'));
});

server.listen(port, function () {
  console.log('App running on port ' + server.address().port);
});
