// webpack.config.js
const path = require("path");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");
module.exports = {
  entry: {
    game: "./src/game.js",
    party: "./src/party.js",
    welcome: "./src/welcome.js",
    index: "./src/index.js",
    signup: "./src/signup.js",
    login: "./src/login.js",
    admin: "./src/admin.js",
  },
  output: {
    filename: "bundles/[name].bundle.js",
    path: path.resolve(__dirname, "dist"),
    publicPath: "/",
  },
  mode: "development",
  devtool: "inline-source-map",
  devServer: {
    port: 3001,
    static: {
      directory: path.resolve(__dirname, "dist"),
      watch: true,
    },
    historyApiFallback: true,
  },
  stats: {
    all: false, // disable everything
    errors: true, // show errors
    warnings: true, // show warnings
    timings: true, // show build timings
    builtAt: true, // show when build happened
    modules: false, // hide module info
    assets: false, // show output files
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: "babel-loader",
        },
      },
      {
        test: /\.css$/,
        use: [
          // Extract CSS into real files instead of injecting via JS to avoid FOUC
          MiniCssExtractPlugin.loader,
          {
            loader: "css-loader",
            options: {
              url: false,
              importLoaders: 1,
              sourceMap: true,
            },
          },
        ],
      },
    ],
  },
  plugins: [
    new MiniCssExtractPlugin({
      filename: "bundles/[name].css",
      chunkFilename: "bundles/[id].css",
    }),
    new CopyWebpackPlugin({
      patterns: [
        {
          from: path.resolve(__dirname, "public"),
          to: path.resolve(__dirname, "dist"),
          noErrorOnMissing: true,
        },
      ],
    }),
  ],
};
