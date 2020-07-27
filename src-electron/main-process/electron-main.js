/**
 *
 *    Copyright (c) 2020 Silicon Labs
 *
 *    Licensed under the Apache License, Version 2.0 (the "License");
 *    you may not use this file except in compliance with the License.
 *    You may obtain a copy of the License at
 *
 *        http://www.apache.org/licenses/LICENSE-2.0
 *
 *    Unless required by applicable law or agreed to in writing, software
 *    distributed under the License is distributed on an "AS IS" BASIS,
 *    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *    See the License for the specific language governing permissions and
 *    limitations under the License.
 */

const fs = require('fs')
const { app } = require('electron')
const dbApi = require('../db/db-api.js')
const sdkGen = require('../sdk-gen/sdk-gen.js')
const args = require('./args.js')
const env = require('../util/env.js')
const {
  generateCodeViaCli,
  setHandlebarTemplateDirForCli,
} = require('./menu.js')
const zclLoader = require('../zcl/zcl-loader.js')
const windowJs = require('./window.js')
const httpServer = require('../server/http-server.js')
const generatorEngine = require('../generator/generation-engine.js')

env.logInitLogFile()

if (process.env.DEV) {
  env.setDevelopmentEnv()
} else {
  env.setProductionEnv()
}

function attachToDb(db) {
  return new Promise((resolve, reject) => {
    env.setMainDatabase(db)
    resolve(db)
  })
}

function startSelfCheck() {
  env.logInitStdout()
  console.log('Starting self-check')
  dbApi
    .initDatabase(env.sqliteFile())
    .then((db) => attachToDb(db))
    .then((db) => dbApi.loadSchema(db, env.schemaFile(), env.zapVersion()))
    .then((db) => zclLoader.loadZcl(db, args.zclPropertiesFile))
    .then((ctx) =>
      generatorEngine.loadTemplates(ctx.db, args.genTemplateJsonFile)
    )
    .then((ctx) => {
      console.log('Self-check done!')
      app.quit()
    })
    .catch((err) => {
      env.logError(err)
      throw err
    })
}

function startNormal(uiEnabled, showUrl, uiMode) {
  dbApi
    .initDatabase(env.sqliteFile())
    .then((db) => attachToDb(db))
    .then((db) => dbApi.loadSchema(db, env.schemaFile(), env.zapVersion()))
    .then((db) => zclLoader.loadZcl(db, args.zclPropertiesFile))
    .then((ctx) =>
      generatorEngine.loadTemplates(ctx.db, args.genTemplateJsonFile)
    )
    .then((ctx) => httpServer.initHttpServer(ctx.db, args.httpPort))
    .then(() => {
      if (uiEnabled) {
        windowJs.initializeElectronUi(httpServer.httpServerPort(), {
          uiMode: uiMode,
        })
      } else {
        if (app.dock) {
          app.dock.hide()
        }
        if (showUrl) {
          // NOTE: this is parsed/used by Studio as the default landing page.
          console.log(
            `url: http://localhost:${httpServer.httpServerPort()}/index.html`
          )
        }
      }
    })
    .catch((err) => {
      env.logError(err)
      throw err
    })
}
/**
 *
 *
 * @param {*} generationDir
 * @param {*} handlebarTemplateDir
 */
function applyGenerationSettings(
  generationDir,
  handlebarTemplateDir,
  zclPropertiesFilePath
) {
  env.logInfo('Start Generation...')
  return dbApi
    .initDatabase(env.sqliteFile())
    .then((db) => attachToDb(db))
    .then((db) => dbApi.loadSchema(db, env.schemaFile(), env.zapVersion()))
    .then((db) =>
      zclLoader.loadZcl(
        db,
        zclPropertiesFilePath ? zclPropertiesFilePath : args.zclPropertiesFile
      )
    )
    .then((ctx) =>
      setGenerationDirAndTemplateDir(generationDir, handlebarTemplateDir)
    )
    .then((res) => app.quit())
}
/**
 *
 *
 * @param {*} generationDir
 * @param {*} handlebarTemplateDir
 * @returns Returns a promise of a generation
 */
function setGenerationDirAndTemplateDir(generationDir, handlebarTemplateDir) {
  if (handlebarTemplateDir) {
    return setHandlebarTemplateDirForCli(
      handlebarTemplateDir
    ).then((handlebarTemplateDir) => generateCodeViaCli(generationDir))
  } else {
    return generateCodeViaCli(generationDir)
  }
}

function startSdkGeneration(
  generationDir,
  handlebarTemplateDir,
  zclPropertiesFilePath
) {
  env.logInfo('Start SDK generation...')
  return dbApi
    .initDatabase(env.sqliteFile())
    .then((db) => attachToDb(db))
    .then((db) => dbApi.loadSchema(db, env.schemaFile(), env.zapVersion()))
    .then((db) =>
      zclLoader.loadZcl(
        db,
        zclPropertiesFilePath ? zclPropertiesFilePath : args.zclPropertiesFile
      )
    )
    .then((ctx) =>
      sdkGen.runSdkGeneration({
        db: ctx.db,
        generationDir: generationDir,
        templateDir: handlebarTemplateDir,
      })
    )
    .then((res) => app.quit())
}

function clearDatabaseFile() {
  var path = env.sqliteFile()
  var pathBak = path + '~'
  if (fs.existsSync(path)) {
    if (fs.existsSync(pathBak)) {
      env.logWarning(`Deleting old backup file: ${pathBak}`)
      fs.unlinkSync(pathBak)
    }
    env.logWarning(
      `Database restart requested, moving file: ${path} to ${pathBak}`
    )
    fs.renameSync(path, pathBak)
  }
}

if (app != null) {
  app.on('ready', () => {
    var argv = args.processCommandLineArguments(process.argv)
    env.logInfo(argv)

    if (argv.clearDb != null) {
      clearDatabaseFile()
    }

    if (argv._.includes('selfCheck')) {
      startSelfCheck()
    } else if (argv._.includes('generate')) {
      // generate can have:
      // - Generation Directory (-output)
      // - Handlebar Template Directory (-template)
      // - Xml Data directory (-xml)
      applyGenerationSettings(argv.output, argv.template, argv.zclProperties)
    } else if (argv._.includes('sdkGen')) {
      startSdkGeneration(argv.output, argv.template, argv.zclProperties)
    } else {
      startNormal(!argv.noUi, argv.showUrl, argv.uiMode)
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('activate', () => {
    env.logInfo('Activate...')
    windowJs.windowCreateIfNotThere(args.httpPort)
  })

  app.on('quit', () => {
    dbApi
      .closeDatabase(env.mainDatabase())
      .then(() => env.logInfo('Database closed, shutting down.'))
  })
}

exports.loaded = true
