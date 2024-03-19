import { program } from 'commander'
import * as fs from 'fs'
import { buildSchema, parse, DocumentNode, GraphQLSchema } from 'graphql'
import { Typer } from './typer'
import { ArgoEncoder } from './encoder'
import { ExecutionResultCodec } from './main'
import { Buf, BufReadonly } from './buf'
import { Wire } from './wire'

function ensureFileExists(path: string) {
    if (!fs.existsSync(path)) {
        program.error(`File not found: ${path}`)
    }

    return path
}

// pnpm cli encode data/shopify/schema.graphql data/shopify/query.graphql data/shopify/data.json
// pnpm cli decode data/shopify/schema.graphql result.argo
program.command('encode')
    .argument('<schema>', 'The path to the schema file', ensureFileExists)
    .argument('<query>', 'The path to the query file', ensureFileExists)
    .argument('<query_result>', 'The path to the query result file', ensureFileExists)
    .action((schema: string, query: string, query_result: string) => {
        encode(schema, query, query_result)
    })

program
    .command('decode')
    .argument('<schema>', 'The path to the schema file', ensureFileExists)
    .argument('<query>', 'The path to the query file', ensureFileExists)
    .argument('<argobin>', 'The path to the query file', ensureFileExists)
    .action((schema: string, query: string, argoBin: string) => {
        decode(schema, query, argoBin)
    })

program.command('desc_encode')
    .argument('<json>', 'The path to the JSON file', ensureFileExists)
    .action((json: string) => {
        encode_desc(json);
    })

program.parse()

async function encode(schemaFile: string, query: string, query_result: string) {
    console.log('encode', schemaFile, query, query_result)

    try {
        const schema = buildSchema(await slurp(schemaFile))
        const queryDoc = parse(await slurp(query))
        const result = JSON.parse(await slurp(query_result))
        const typer = new Typer(schema, queryDoc)
        const rootWireType = typer.rootWireType()

        console.log(JSON.stringify(rootWireType, null, 2))

        const ci = new ExecutionResultCodec(schema, queryDoc)
        const argoBytes = ci.jsToArgo(result)
        argoBytes.compact()

        fs.writeFileSync('result.argo', argoBytes.uint8array)
    } catch (error) {
        if (error instanceof Error) {
            program.error(`Error: ${error.message}`)
        } else {
            program.error(`An unexpected error occurred. ${error}`)
        }
    }
}

async function encode_desc(json: string) {
    const input = JSON.parse(await slurp(json))

    const encoder = new ArgoEncoder()
    encoder.header.selfDescribing = true
    encoder.jsToArgoWithType(input, Wire.DESC)
    const argoBytes = encoder.getResult();
    await fs.promises.writeFile('result.argo', argoBytes.uint8array)
}

async function decode(schemaFile: string, query: string, argoBin: string) {
    console.log('decode', schemaFile, argoBin)

    try {
        const schema = buildSchema(await slurp(schemaFile))
        const queryDoc = parse(await slurp(query))
        const argoBytes = await slurpBinary(argoBin)

        const typer = new Typer(schema, queryDoc)
        const ci = new ExecutionResultCodec(schema, queryDoc)

        const buf = new Buf()
        buf.write(argoBytes)
        buf.compact()
        buf.resetPosition()

        const result = ci.argoToJs(buf)
        fs.writeFileSync('result.json', JSON.stringify(result, null, 2))
        console.log('result.json written')
    } catch (error) {
        if (error instanceof Error) {
            program.error(`Error: ${error.message}`)
        } else {
            program.error(`An unexpected error occurred. ${error}`)
        }
    }
}

async function wireType(schemaFile: string, query: string, argoBin: string) {
}

function slurp(file: Promise<fs.promises.FileHandle> | string): Promise<string> {
  if (typeof (file) === 'string') {
    return slurp(fs.promises.open(file))
  }
  return file.then(f => {
    const contents = f.readFile({ encoding: 'utf8' })
    f.close()
    return contents
  })
}

function slurpBinary(file: Promise<fs.promises.FileHandle> | string): Promise<Buffer> {
  if (typeof (file) === 'string') {
    return slurpBinary(fs.promises.open(file))
  }
  return file.then(f => {
    const contents = f.readFile()
    f.close()
    return contents
  })
}
