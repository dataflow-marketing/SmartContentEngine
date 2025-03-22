import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';

export function parseArgs() {
  const argv = yargs(hideBin(process.argv))
    .usage('Usage: $0 [--sitemap <sitemapUrl>] [--domain <domainName>] [--slow] [--force] [--batch-size <number>]')
    .option('sitemap', {
      alias: 's',
      type: 'string',
      description: 'Sitemap URL to crawl'
    })
    .option('domain', {
      alias: 'd',
      type: 'string',
      description: 'Domain name to process'
    })
    .option('slow', {
      alias: 'l',
      type: 'boolean',
      default: false,
      description: 'Run in slow mode'
    })
    .option('force', {
      alias: 'f',
      type: 'boolean',
      default: false,
      description: 'Force reprocessing'
    })
    .option('batch-size', {
      alias: 'b',
      type: 'number',
      default: 1,
      description: 'Number of files to process concurrently'
    })
    .help()
    .argv;

  return {
    sitemapUrl: argv.sitemap,
    domainName: argv.domain,
    slowMode: argv.slow,
    force: argv.force,
    batchSize: argv['batch-size']
  };
}