var FacebookTokenStrategy = require('passport-facebook-token').Strategy;
var LocalStrategy = require('passport-local').Strategy;
var bcrypt = require('bcrypt-nodejs');
var async = require('async');
var mysql = require('mysql');
var path = require('path');
var dbConfig = require('./database');
var pool = mysql.createPool(dbConfig);
var logger = require('./logger');
var server = 'http://ec2-54-64-102-246.ap-northeast-1.compute.amazonaws.com';
var s3 = require('s3');
var s3Config = require('../config/s3');

var facebookAuthConfig = require('./auth').facebookAuth;

module.exports = function(passport) {
	
  passport.serializeUser(function(user, done) {
    logger.debug('passport.serializeUser()', user);
    done(null, user.userId);
  });
  
  passport.deserializeUser(function(userId, done) {
  	  /* avoid network I/O bottleneck by using nextTick */
  	process.nextTick(function() {
  		pool.getConnection(function(err, connection) {
        if (err) {
        	logger.error(err);
        	connection.release();
          return done(err);
        }
        var selectQry = 'SELECT user_id, user_name, email, password, profile_photo, facebook_id, facebook_token, exam_date, target_level, agreement, gcm_id, notification, birthday ' +
                        'FROM users ' +
                        'WHERE user_id = ?';
        connection.query(selectQry, [userId], function(err, rows, fields) {
        	if (err) {
						logger.error(err);
						connection.release();
						return done(err);
					}
          var user = {};
          user.userId = rows[0].user_id;
          user.userName = rows[0].user_name;
          user.email = rows[0].email;
          user.password = rows[0].password;
          user.profilePhoto = rows[0].profile_photo;
          user.facebookId = rows[0].facebook_id;
          user.facebookToken = rows[0].facebook_token;
          user.examDate = rows[0].examDate;
          user.targetLevel = rows[0].targetLevel;
          user.agreement = rows[0].agreement;
          user.gcmId = rows[0].gcm_id;
          user.notification = rows[0].notification;
          user.birthday = rows[0].birthday;
          
          connection.release();
          logger.debug('passport.deserializeUser()', user);
          return done(null, user);
        }); // end of connection.query
      }); // end of pool
  	}); // end of nextTick
  });
  
    /* local-signup */
  passport.use('local-signup', new LocalStrategy({
    usernameField: 'email',
    passwordField: 'password',
    passReqToCallback: true
  },
    /* verify callback */
  function(req, email, password, done) {
  	  /* avoid network I/O bottleneck by using nextTick */
    process.nextTick(function() {
      pool.getConnection(function(err, connection) {
        if (err) {
        	logger.error(err);
        	connection.release();
          return done(err);
        }
        async.waterfall([
          function beginTransaction(callback) {
          	connection.beginTransaction(function(err) {
          		if (err) {
          			return callback(err);
          		}
          		callback();
          	});
          },
          function duplicateCheck(callback) {
          	var selectQry = 'SELECT user_id ' +
          	                'FROM users ' +
          	                'WHERE email = ?';
          	connection.query(selectQry, [email], function(err, rows, fields) {
          		if (err) {
          			return callback(err);
          		}
          		if (rows.length) {
          			connection.release();
          			return done(null, false, req.flash('signupMessage', 'That email is already taken.'));
          		}
          		else {
          			callback();
          		}
          	});
          },
          function generateSalt(callback) {
            var rounds = 10;
            bcrypt.genSalt(rounds, function(err, salt) {
            	if (err) {
            		return callback(err);
             	}
              logger.debug('bcrypt.genSalt() ====> ' + salt + '(' + salt.toString().length +')');
              callback(null, salt);
            });
          },
          function hashPassword(salt, callback) {
            bcrypt.hash(password, salt, null, function(err, hashPass) {
            	if (err) {
            		return callback(err);
            	}
              logger.debug('bcrypt.hash() ====> ' + hashPass + '(' + hashPass.length + ')');
              var params = {
              	localFile: 'default.png',
              	s3Params: {
              		Bucket: s3Config.bucket,
              		Key: s3Config.imageDir + 'default.png',
              		ACL: s3Config.ACL
              	}
              };
              var newUser = {};
              newUser.email = email;
              newUser.password = hashPass;
              newUser.userName = req.body.userName;
              newUser.profilePhoto = s3.getPublicUrl(params.s3Params.Bucket, params.s3Params.Key, s3Config.region);
              newUser.agreement = 1;
              newUser.birthday = req.body.birthday;
              callback(null, newUser);
            });
          },
          function(newUser, callback) {
          	var insertQry = 'INSERT INTO users ' +
          	                '(user_name, email, password, profile_photo, agreement, birthday) ' +
          	                'VALUES (?, ?, ?, ?, ?, ?)';
          	connection.query(insertQry, [newUser.userName, newUser.email, newUser.password, newUser.profilePhoto, newUser.agreement, newUser.birthday], function(err, result) {
          		if (err) {
          			return callback(err);
          		}
          		newUser.userId = result.insertId;
          		callback(null, newUser);
          	});
          },
          function commit(newUser, callback) {
          	connection.commit(function(err) {
          		if (err) {
          			return callback(err);
          		}
          		connection.release();
          		callback(null, newUser);
          	});
          } // end of commit
        ],
        function(err, newUser) {
        	if (err) {
        		connection.rollback(function() {
        			logger.error(err);
        			connection.release();
        			err.message = '회원가입 과정에서 오류가 발생하였습니다.';
        			return done(err);
        		});
        	}
        	return done(null, newUser);
        }); // end of async.waterfall
      }); // end of pool
    }); // end of process.nextTick
  }));
  
    /* local-login */
  passport.use('local-login', new LocalStrategy({
    usernameField: 'email',
    passwordField: 'password',
    passReqToCallback: true
  },
    /* verify callback */
  function(req, email, password, done) {	
  	  /* avoid network I/O bottleneck by using nextTick */
    process.nextTick(function() {
      pool.getConnection(function(err, connection) {
        if (err) {
        	logger.error(err);
        	connection.release();
          return done(err);
        }
        async.waterfall([
          function beginTransaction(callback) {
          	connection.beginTransaction(function(err) {
          		if (err) {
          			return callback(err);
          		}
          		callback();
          	});
          },
          function(callback) {
          	var selectQry = 'SELECT user_id, user_name, email, password, profile_photo, exam_date, target_level, agreement, gcm_id, notification, birthday ' +
                            'FROM users ' +
                            'WHERE email = ?';
          	connection.query(selectQry, [email], function(err, rows, fields) {
          		if (err) {
          			return callback(err);
          		}
          		if (!rows.length) {
          			connection.release();
          			return done(null, false, req.flash('loginMessage', 'No user found.'));
          		}
          		var user = {};
          		user.userId = rows[0].user_id;
          		user.userName = rows[0].user_name;
          		user.email = rows[0].email;
          		user.password = rows[0].password;
          		user.profilePhoto = rows[0].profile_photo;
          		user.examDate = rows[0].exam_date;
          		user.targetLevel = rows[0].target_level;
          		user.agreement = rows[0].agreement;
          		user.gcmId = rows[0].gcm_id;
          		user.notification = rows[0].notification;
          		user.birthday = rows[0].birthday;
          		
              bcrypt.compare(password, user.password, function(err, result) {
              	if (err) {
              		return callback(err);
              	}
                if (!result){
                  return done(null, false, req.flash('loginMessage', 'Oops! wrong password.'));
                }          
                logger.debug('bcrypt.compare() ====> ' + user.password + '(' + user + ')');
              });
              callback(null, user);
            }); // end of connection.query
          },
          function(user, callback) {
          	var updateGcmId = 'UPDATE users ' +
                              'SET gcm_id = ? ' +
                              'WHERE user_id = ?';
            connection.query(updateGcmId, [req.body.gcmId, user.userId], function(err, result) {
              if (err) {
              	return callback(err);
              }
              connection.release();
              callback(null, user);
            });
          },
          function commit(user, callback) {
          	connection.commit(function(err) {
          		if (err) {
          			return callback(err);
          		}
          		callback(null, user);
          	});
          } // end of commit
        ],
        function(err, user) {
        	if (err) {
        		connection.rollback(function() {
        			logger.error(err);
        			connection.release();
        			return done(err);
        		});
        	}
        	return done(null, user);
        }); // end of async.waterfall
      }); // end of connectionPool.getConnection
    }); // end of process.nextTick
  }));
  
  passport.use(new FacebookTokenStrategy({
  	clientID: facebookAuthConfig.clientID,
  	clientSecret: facebookAuthConfig.clientSecret,
  	passReqToCallback: true
  },
  function(req, accessToken, refreshToken, profile, done) {
  	process.nextTick(function() {
  		pool.getConnection(function(err, connection) {
  			if (err) {
  				logger.error(err);
  				connection.release();
  				return done(err);
  			}
  			var selectQry = 'SELECT user_id, user_name, email, profile_photo, facebook_id, facebook_token, exam_date, target_level, agreement, gcm_id, notification, birthday ' +
  			                'FROM users ' +
  			                'WHERE facebook_id = ?';
  			connection.query(selectQry, [profile.id], function(err, rows, fields) {
  				if (err) {
  					logger.error(err);
  					connection.release();
  					return done(err);
  				}
  				var facebookPhoto = "https://graph.facebook.com/v2.1/me/picture?access_token=" + accessToken;
  				if (rows.length) {
  					var user = {};
  					user.userId = rows[0].user_id;
  					user.userName = rows[0].user_name;
  					user.email = rows[0].email;
  					user.profilePhoto = rows[0].profile_photo;
  					user.facebookId = rows[0].facebook_id;
  					user.facebookToken = rows[0].facebook_token;
  					user.examDate = rows[0].exam_date;
            user.targetLevel = rows[0].target_level;
            user.agreement = rows[0].agreement;
            user.gcmId = rows[0].gcm_id;
            user.notification = rows[0].notification;
            user.birthday = rows[0].birthday;
            
            if (user.gcmId !== req.body.gcmId) {
            	var updateGcmId = 'UPDATE users ' +
            	                  'SET gcm_id = ? ' +
            	                  'WHERE user_id = ?';
            	connection.query(updateGcmId, [req.body.gcmId, user.userId], function(err, result) {
            		if (err) {
            			logger.error(err);
            			connection.release();
            			return done(err);
            		}
            	});
            }
  					
  					if (accessToken !== user.facebookToken) {
  						var updateQry = 'UPDATE users ' +
  						                'SET facebook_token = ?, profile_photo = ? ' +
  						                'WHERE facebook_id = ?';
  						connection.query(updateQry, [accessToken, facebookPhoto, profile.id], function(err, result) {
  							if (err) {
  								logger.error(err);
  								connection.release();
  								return done(err);
  							}
  							return done(null, user);
  						}); // end of connection.query
  					} else {
  						return done(null, user);
  					}
  					connection.release();
  				} else { /* 페이스북 최초 요청 */  					
  					var newUser = {};
  					newUser.facebookId = profile.id;
  					newUser.facebookToken = accessToken;
  					newUser.facebookEmail = profile.emails[0].value;
  					newUser.facebookName = profile.name.givenName + ' ' + profile.name.familyName;
  					newUser.facebookPhoto = facebookPhoto;
  					newUser.gcmId = req.body.gcmId;
  					
  					async.waterfall([
  					  function beginTransaction(callback) {
  					  	connection.beginTransaction(function(err) {
  					  		if (err) {
  					  			return callback(err);
  					  		}
  					  		callback();
  					  	});
  					  },
  					  function(callback) {
  					  	var insertQry = 'INSERT INTO users ' +
                                '(user_name, email, profile_photo, facebook_id, facebook_token) ' +
                                'VALUES (?, ?, ?, ?, ?)';  					  	
  					  	connection.query(insertQry, [newUser.facebookName, newUser.facebookEmail, newUser.facebookPhoto, newUser.facebookId, newUser.facebookToken], function(err, result) {
  	  						if (err) {
  	  							return callback(err);
  	  						}
  	  						newUser.userId = result.insertId;
  	  						callback(null, newUser);
  	  					});
  					  },
  					  function(newUser, callback) {
  					  	var updateGcmIdFirst = 'UPDATE users ' +
  					  	                       'SET gcm_id = ? ' +
  					  	                       'WHERE user_id = ?';
  					  	connection.query(updateGcmIdFirst, [newUser.gcmId, newUser.userId], function(err, result) {
  					  		if (err) {
  					  			return callback(err);
  					  		}
  					  		callback(null, newUser);
  					  	});
  					  }, // end of updateGcmId
  					  function commit(newUser, callback) {
  					  	connection.commit(function(err) {
  					  		if (err) {
  					  			return callback(err);
  					  		}
  					  		callback(null, newUser);
  					  	});
  					  } // end of commit
  					],
  					function(err, newUser) {
  						if (err) {
  							connection.rollback(function() {
  								logger.error(err);
    							connection.release();
    							return done(err);
  							});
  						}
  						connection.release();
  						return done(null, newUser);
  					});
  				} // end of else (페이스북 최초 요청)
  			}); // end of connection.query
  		}); // end of pool
  	}); // end of nextTick
  }
  ));
};