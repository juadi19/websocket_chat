require("dotenv").config();
const passport = require("passport");
const JWTStrategy = require("passport-jwt").Strategy;
const ExtractJWT = require("passport-jwt").ExtractJwt;
const localStrategy = require("passport-local").Strategy;
const bcrypt = require("bcrypt");
const queryDatabase = require("../src/helpers/queryDB");
const connection = require("../connectDatabase").connection;

passport.use(
  "signup",
  new localStrategy(
    {
      usernameField: "name",
      passwordField: "password",
      passReqToCallback: true,
    },
    async function (req, name, password, done) {
      if (!req.body.profilePictureUrl)
        req.body.profilePictureUrl =
          "https://upload.wikimedia.org/wikipedia/commons/7/7c/Profile_avatar_placeholder_large.png?20150327203541";
      if (!req.body.color) return done("Color requerido");

      try {
        const user = await queryDatabase(
          `INSERT INTO users (name, profilePictureUrl, color, password) VALUES ('${name}', '${
            req.body.profilePictureUrl
          }', '${req.body.color}', '${bcrypt.hashSync(password, 10)}');`,
          connection
        );
        console.log(user);
        return done(null, { name });
      } catch (error) {
        //Duplicado
        if (error.errno === 1062) {
          done("Ese usuario ya esta registrado");
        } else {
          console.log(error);
          done("Error de servidor");
        }
      }
    }
  )
);

passport.use(
  "login",
  new localStrategy(
    {
      usernameField: "name",
      passwordField: "password",
    },
    async function (name, password, done) {
      try {
        const [user] = await queryDatabase(
          `SELECT id, name, profilePictureUrl, color, password FROM users WHERE users.name="${name}"`,
          connection
        );
        if (!user)
          return done(null, null, {
            message: "Usuario o contraseña incorrecta",
          });

        if (!bcrypt.compareSync(password, user.password)) {
          return done(null, null, {
            message: "Usuario o contraseña incorrecta",
          });
        }

        delete user.password;
        return done(null, user);
      } catch (error) {
        return done(error);
      }
    }
  )
);

passport.use(
  new JWTStrategy(
    {
      secretOrKey: process.env.JWT_SECRET,
      jwtFromRequest: ExtractJWT.fromAuthHeaderAsBearerToken(),
    },
    async (token, done) => {
      try {
        console.log(token);
        const [user] = await queryDatabase(
          `SELECT id, name, profilePictureUrl, color FROM users WHERE users.name="${token.name}"`,
          connection
        );
        if (!user)
          return done(null, null, {
            message: "Usuario no encontrado",
          });
        return done(null, user);
      } catch (error) {
        return done(error);
      }
    }
  )
);
