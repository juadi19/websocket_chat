require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const http = require("http");
const { Server } = require("socket.io");
const mysql = require("mysql2");
const queryDatabase = require("./helpers/queryDB");
const passport = require("passport");
const connectDatabase = require("../connectDatabase");
const jwt = require("jsonwebtoken");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const userSockets = {};

async function startServer() {
  try {
    await connectDatabase();

    require("../auth/auth");
    const connection = require("../connectDatabase").connection;

    const createQuery = await queryDatabase(
      "CREATE DATABASE IF NOT EXISTS chat;",
      connection
    );
    //Si la base de datos se acaba de crear
    if (createQuery.warningStatus === 0) {
      try {
        console.log("Creando base de datos...");
        await queryDatabase(
          "CREATE TABLE `chat`.`users` (`id` INT NOT NULL AUTO_INCREMENT , `name` VARCHAR(100) NOT NULL UNIQUE , `profilePictureUrl` VARCHAR(500) NOT NULL , `color` VARCHAR(10) NOT NULL , `password` VARCHAR(100) NOT NULL, PRIMARY KEY (`id`)) ENGINE = InnoDB;",
          connection
        );

        await queryDatabase(
          "CREATE TABLE `chat`.`messages` (`id` INT NOT NULL AUTO_INCREMENT , `content` TEXT NOT NULL , `fromUser` INT NOT NULL , `toUser` INT NULL , `sentAt` DATETIME NOT NULL DEFAULT NOW(), PRIMARY KEY (`id`) ) ENGINE = InnoDB;",
          connection
        );
        console.log("Base de datos creada");
      } catch (error) {
        await queryDatabase("DROP DATABASE chat", connection);
        console.log(error);
      }
    }
    await queryDatabase("USE chat;", connection);

    io.on("connection", (socket) => {
      const token = socket.handshake.auth?.token;

      jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
          socket.emit("invalid-token");
          socket.disconnect();
        } else {
          const user = decoded;
          socket.join(`userId#${user.id}`);

          if (userSockets[user.id]) {
            userSockets[user.id].sockets.push(socket);
          } else {
            userSockets[user.id] = { sockets: [], user };
            io.emit("online-user", user);
            userSockets[user.id].sockets.push(socket);
          }

          console.log(
            `${user.name} tiene ${userSockets[user.id].sockets.length} socket`
          );
          console.log(
            "Hay " + Object.keys(userSockets).length + "usuarios conectados"
          );
        }
      });
      //socket.disconnect();

      socket.on("disconnect", () => {
        const token = socket.handshake.auth?.token;

        jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
          if (err) {
            socket.emit("invalid-token");
            socket.disconnect();
          } else {
            const user = decoded;
            if (userSockets[user.id]) {
              userSockets[user.id].sockets = userSockets[
                user.id
              ].sockets.filter(
                (currentSocket) => socket.id != currentSocket.id
              );
              if (userSockets[user.id].sockets.length == 0) {
                delete userSockets[user.id];
                io.emit("offline-user", user);
              }
            }
          }
        });
        console.log("desconectado");
        socket.disconnect();
      });

      socket.on("new-message", async ({ content, toUserId }) => {
        let toUser, fromUser;
        // List of special characters used in MySQL that can cause problems
        const specialCharacters = /[\\`'"_%]/g;

        // Replace special characters with escaped versions
        content = content.replace(specialCharacters, "\\$&");
        if (toUserId !== "general") {
          [toUser] = await queryDatabase(
            `SELECT * FROM users WHERE id='${toUserId}'`,
            connection
          );

          if (!toUser) {
            socket.emit("error", "Usuario no encontrado");
            return;
          }
        }
        jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
          if (err) {
            socket.emit("invalid-token");
            socket.disconnect();
          } else {
            fromUser = decoded;
          }
        });

        content = content.replace(/[']/g, '"');
        const messageToSend = {
          content,
          sentBy: fromUser,
          sentAt: new Date(),
        };

        if (toUserId !== "general") {
          await queryDatabase(
            `INSERT INTO messages (content, fromUser, toUser) VALUES ('${content}', ${fromUser.id}, ${toUser.id})`,
            connection
          );
        } else {
          await queryDatabase(
            `INSERT INTO messages (content, fromUser, toUser) VALUES ('${content}', ${fromUser.id}, NULL)`,
            connection
          );
        }
        if (toUser)
          io.to(`userId#${toUser.id}`)
            .to(`userId#${fromUser.id}`)
            .emit("receive-message", messageToSend);
        else io.emit("general-message", messageToSend);
      });
    });

    app.use(bodyParser.json()); // for parsing application/json
    app.use(express.static("public"));
    app.use(
      cors({
        origin: "*",
      })
    );

    app.get("/users", async (req, res) => {
      const users = {
        online: [],
        offline: [],
      };

      for (const userSocket of Object.values(userSockets)) {
        users.online.push(userSocket.user);
      }

      if (users.online.length > 0) {
        const onlineUserNames = users.online
          .map((u) => `"${u.name}"`)
          .join(",");
        users.offline = await queryDatabase(
          `SELECT * FROM users WHERE users.name NOT IN (${onlineUserNames});`,
          connection
        );
      }

      res.send(users);
    });

    app.get(
      "/users/:id/messages",
      passport.authenticate("jwt", { session: false }),
      async (req, res) => {
        //Obtener los mensajes que han sido enviados anteriormente, haciendo que las relaciones sean objetos json
        if (req.params.id !== "general") {
          const user = req.user;
          const userMessage = await queryDatabase(
            `SELECT *
            FROM (
              SELECT
                messages.id,
                messages.content,
                messages.sentAt,
                JSON_OBJECT('id', fromUser.id, 'name', fromUser.name, 'profilePictureUrl', fromUser.profilePictureUrl, 'color', fromUser.color) AS fromUser,
                IF(messages.toUser IS NULL, NULL, JSON_OBJECT('id', toUser.id, 'name', toUser.name, 'profilePictureUrl', toUser.profilePictureUrl, 'color', toUser.color)) AS toUser
              FROM messages
              INNER JOIN users AS fromUser ON fromUser.id = messages.fromUser
              LEFT JOIN users AS toUser ON toUser.id = messages.toUser
              WHERE (fromUser=${user.id} AND toUser=${req.params.id}) OR (fromUser=${req.params.id} AND toUser=${user.id})
              ORDER BY messages.id DESC
            ) AS subquery
            ORDER BY subquery.id ASC;`,
            connection
          );
          res.send(userMessage);
        } else {
          const userMessage = await queryDatabase(
            `SELECT *
            FROM (
              SELECT
                messages.id,
                messages.content,
                messages.sentAt,
                JSON_OBJECT('id', fromUser.id, 'name', fromUser.name, 'profilePictureUrl', fromUser.profilePictureUrl, 'color', fromUser.color) AS fromUser,
                IF(messages.toUser IS NULL, NULL, JSON_OBJECT('id', toUser.id, 'name', toUser.name, 'profilePictureUrl', toUser.profilePictureUrl, 'color', toUser.color)) AS toUser
              FROM messages
              INNER JOIN users AS fromUser ON fromUser.id = messages.fromUser
              LEFT JOIN users AS toUser ON toUser.id = messages.toUser
              WHERE messages.toUser IS NULL
              ORDER BY messages.id DESC
              LIMIT 10
            ) AS subquery
            ORDER BY subquery.id ASC;`,
            connection
          );
          res.send(userMessage);
        }
      }
    );

    app.post(
      "/signup",
      passport.authenticate("signup", { session: false }),
      async (req, res, next) => {
        res.send({ message: "Cuenta creada exitosamente", user: req.user });
      }
    );

    app.post(
      "/login",
      passport.authenticate("login", { session: false }),
      (req, res, next) => {
        const token = jwt.sign(req.user, process.env.JWT_SECRET);
        res.send({ token });
      }
    );

    app.get(
      "/validate",
      passport.authenticate("jwt", { session: false }),
      async (req, res) => {
        res.send(req.user);
      }
    );

    server.listen(process.env.PORT, () => {
      console.log("Server running at port", process.env.PORT);
    });
  } catch (error) {
    console.log(error);
  }
}
startServer();
