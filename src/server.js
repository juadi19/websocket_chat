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
      console.log("Un usuario se conectó");
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
            userSockets[user.id].sockets.push(socket);
          }

          console.log(
            `${user.name} tiene ${userSockets[user.id].sockets.length} socket`
          );
          console.log(Object.keys(userSockets).length);
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
              }
            }
          }
        });
        socket.disconnect();
      });

      socket.on("new-message", async ({ content, toUserId }) => {
        let toUser, fromUser;
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
        console.log(userSocket);
      }

      res.send(users);
    });

    app.get(
      "/users/:id/messages",
      passport.authenticate("jwt", { session: false }),
      async (req, res) => {
        if (req.params.id !== "general") {
          const user = req.user;
          const userMessage = await queryDatabase(
            `SELECT * FROM messages WHERE (fromUser=${user.id} AND toUser=${req.params.id}) OR (fromUser=${req.params.id} AND toUser=${user.id})`,
            connection
          );
          res.send(userMessage);
        } else {
          const userMessage = await queryDatabase(
            `SELECT * FROM messages WHERE toUser=NULL LIMIT 10`,
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
        console.log(process.env.JWT_SECRET);
        const token = jwt.sign(req.user, process.env.JWT_SECRET);
        res.send({ token });
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
