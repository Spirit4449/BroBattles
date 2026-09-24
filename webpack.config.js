// webpack.config.js
const path = require("path");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");
module.exports = (_env = {}, argv = {}) => {
  const mode = argv.mode || "development";

  return {
  // Persist module and CopyWebpackPlugin snapshots between CLI invocations.
  // CopyWebpackPlugin reuses a cached source when a file's snapshot is unchanged,
  // and Webpack's compareBeforeEmit avoids rewriting an identical output file.
  cache: {
    type: "filesystem",
    cacheDirectory: path.resolve(__dirname, "node_modules/.cache/webpack"),
    name: `bro-battles-${mode}`,
    buildDependencies: {
      config: [__filename],
    },
  },
  entry: {
    navigation: "./src/navigation/index.js",
    site: "./src/site/index.js",
    game: "./src/game.js",
    mapEditor: "./src/editor/mapEditor.js",
    party: "./src/party.js",
    index: "./src/index.js",
    signup: "./src/signup.js",
    login: "./src/login.js",
    admin: "./src/admin.js",
    profile: "./src/profile.js",
  },
  output: {
    chunkLoadingGlobal: "webpackChunkBroBattles",
    filename: "bundles/[name].bundle.js",
    path: path.resolve(__dirname, "dist"),
    publicPath: "/",
    // Do not delete dist before emitting: preserved assets let Webpack skip
    // unchanged writes. Run `npm run cleanbuild` when a full clean is needed.
    clean: false,
  },
  mode,
  devtool: mode === "production" ? false : "inline-source-map",
  devServer: {
    port: 3001,
    devMiddleware: {
      etag: "strong",
      cacheControl: "public, max-age=0, must-revalidate",
    },
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
      { test: /\.webp$/, resourceQuery: /portrait/, type: "asset/inline" },
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
    new (require("./scripts/build/pageRuntime.cjs"))(),
    ...(mode === "production" ? [new (require("./scripts/build/versionHtmlAssets.cjs"))()] : []),
    new MiniCssExtractPlugin({
      filename: "bundles/[name].css",
      chunkFilename: "bundles/[id].css",
    }),
    new CopyWebpackPlugin({
      patterns: [
        {from:path.resolve(__dirname,"node_modules/phaser/dist/phaser-arcade-physics.min.js"),to:"bundles/phaser-arcade-physics.min.js"},
        {
          from: path.resolve(__dirname, "public"),
          to: path.resolve(__dirname, "dist"),
          noErrorOnMissing: true,
        },
      ],
    }),
  ],
  };
};
