require("dotenv").config();
const mysql = require("mysql2");

async function connectDatabase() {
  try {
    //Conectar a la base de datos
    const connection = mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      port: process.env.DB_PORT,
    });

    await connection.connect();
    module.exports.connection = connection;
  } catch (e) {
    console.error(e);
  }
}

module.exports = connectDatabase;
