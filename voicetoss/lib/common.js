var logger = require('../config/logger');
  /* 로그인 인증 여부 확인 */
module.exports.isLoggedIn = function isLoggedIn(req, res, next) {
  if (req.isAuthenticated()) {
    logger.debug("req.isAuthenticated() ====> true");
    logger.debug('userId: ' + req.user.userId + ', email: ' + req.user.email);
    return next();
  }
  logger.debug("req.isAuthenticated() ====> false");
  if (req.params.groupId) {
  	res.json({
  		"success" : 1,
      "result" : {
      	"message": "로그인 인증 불가",
      	"groupId": req.params.groupId,
      	"login": 0
      }
    });
  }
  return;
};