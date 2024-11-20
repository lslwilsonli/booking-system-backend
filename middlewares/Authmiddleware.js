const jwt = require("jsonwebtoken");

const authorization_v2 = (req, res, next) => {
  const token = req.headers["authorization"]?.split(" ")[1];
  // console.log("Here is the token", token);

  if (!token) {
    return res.status(403).json({ message: "No token provided." });
  }

  jwt.verify(token, process.env.JWT_SECRET, (error, decoded) => {
    if (error) {
      return res.status(403).json({ message: "Invalid or expired token." });
    } else {
      req.merchantId = decoded.payload.merchant_id;
      next();
    }
  });
};

module.exports = authorization_v2;
