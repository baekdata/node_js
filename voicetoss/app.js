var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');

var passport = require('passport');
var flash = require('connect-flash');
var session = require('express-session');
var SessionStore = require('express-mysql-session');

  /* session store options */
var options = require('./config/sessionstore');

require('./config/passport')(passport);

var user = require('./routes/user');
var mybox = require('./routes/mybox');
var groupbox = require('./routes/groupbox');
var post = require('./routes/post');
var comment = require('./routes/comment');

var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());

  /* session property value setting */
app.use(session({
	store : new SessionStore(options),
	secret : 'voicetoss',
	cookie : {
		maxAge : 86400000
	},
	resave : true,
	saveUninitialized : true
}));

app.use(passport.initialize());
app.use(passport.session());
app.use(flash());

app.use(express.static(path.join(__dirname, 'public')));

  /* mount */
app.use('/user', user);
app.use('/mybox', mybox);
app.use('/groupbox', groupbox);
app.use('/post', post);
app.use('/comment', comment);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// error handlers

// development error handler
// will print stacktrace
/*
if (app.get('env') === 'development') {
  app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    res.json({
     	"success": 0,
      "result": {
      	"message": err.message
      }
    });
  });
}
*/

// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res, next) {
  res.status(err.status || 500);
  res.json({
  	"success": 0,
  	"result": {
  		"message": err.message
  	}
  });
});

module.exports = app;