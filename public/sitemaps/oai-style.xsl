<?xml version="1.0" encoding="UTF-8"?>
<!--
  Brutalist stylesheet for the jcrt.org OAI-PMH endpoint.

  /oai speaks a machine protocol, so a person who opens it in a browser gets raw
  XML — and, with no verb, a bare `badVerb` error. That error is CORRECT: OAI-PMH
  requires it, and harvesters depend on it. So the protocol is left alone and this
  stylesheet gives the same response a readable face, turning the error into an
  explanation of what the endpoint is and which verbs it answers.

  Browsers apply it via the <?xml-stylesheet?> processing instruction that
  scripts/lib/oai-pmh.mjs writes into every response; harvesters ignore the
  instruction and read the XML underneath. Mirrors sitemaps/style.xsl in jcrt-files.
-->
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:oai="http://www.openarchives.org/OAI/2.0/"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:oai_dc="http://www.openarchives.org/OAI/2.0/oai_dc/">

  <xsl:output method="html" encoding="UTF-8" indent="yes"
    doctype-system="about:legacy-compat" />

  <xsl:template match="/">
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, follow" />
        <title>OAI-PMH — jcrt.org</title>
        <style>
          html {
            max-width: 70ch;
            padding: 3em 1em;
            margin: auto;
            line-height: 1.75;
            font-size: 1.25em;
            background: #000;
            color: #fff;
          }

          body {
            margin: 0;
            font-family: system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            background: #000;
            color: #fff;
          }

          h1, h2, .mono {
            font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, 'DejaVu Sans Mono', monospace;
            font-weight: normal;
          }

          h1 {
            font-size: 1.4em;
            margin: 0 0 .25em;
            text-transform: uppercase;
            letter-spacing: .04em;
          }

          h2 {
            font-size: 1em;
            margin: 2.5em 0 .5em;
            text-transform: uppercase;
            letter-spacing: .04em;
            border-bottom: 3px solid #fff;
            padding-bottom: .25em;
          }

          .meta {
            margin: 0 0 2em;
            color: #b9b9b9;
            font-size: .8em;
          }

          a {
            color: #fff;
            text-decoration: underline;
            text-underline-offset: .18em;
            overflow-wrap: anywhere;
          }

          a:hover,
          a:focus {
            background: #fff;
            color: #000;
            text-decoration: none;
            outline: none;
          }

          dl {
            margin: 0;
            display: grid;
            grid-template-columns: minmax(12ch, auto) 1fr;
            gap: .25em 1.5ch;
          }

          dt {
            font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, 'DejaVu Sans Mono', monospace;
            color: #b9b9b9;
          }

          dd {
            margin: 0;
            overflow-wrap: anywhere;
          }

          ol {
            margin: 0;
            padding: 0;
            list-style: none;
            counter-reset: row;
          }

          li {
            counter-increment: row;
            border-bottom: 1px solid #3a3a3a;
            padding: .5em 0;
          }

          .rec-title { display: block; }

          .rec-meta {
            display: block;
            color: #b9b9b9;
            font-size: .78em;
            font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, 'DejaVu Sans Mono', monospace;
          }

          .err {
            border: 3px solid #fff;
            padding: 1em;
            margin: 0 0 2em;
          }

          .err code {
            font-size: .85em;
            color: #b9b9b9;
          }

          .note {
            color: #b9b9b9;
            font-size: .85em;
          }
        </style>
      </head>
      <body>
        <h1>OAI-PMH</h1>
        <p class="meta">
          Metadata harvesting endpoint for
          <a href="https://jcrt.org/">jcrt.org</a> ·
          responded <span class="mono"><xsl:value-of select="oai:OAI-PMH/oai:responseDate" /></span>
        </p>

        <xsl:apply-templates select="oai:OAI-PMH/oai:error" />
        <xsl:apply-templates select="oai:OAI-PMH/oai:Identify" />
        <xsl:apply-templates select="oai:OAI-PMH/oai:ListMetadataFormats" />
        <xsl:apply-templates select="oai:OAI-PMH/oai:ListSets" />
        <xsl:apply-templates select="oai:OAI-PMH/oai:ListIdentifiers" />
        <xsl:apply-templates select="oai:OAI-PMH/oai:ListRecords" />
        <xsl:apply-templates select="oai:OAI-PMH/oai:GetRecord" />

        <xsl:call-template name="verbs" />
      </body>
    </html>
  </xsl:template>

  <!-- An error is the usual landing state: /oai with no verb must return badVerb. -->
  <xsl:template match="oai:error">
    <div class="err">
      <p>
        <strong>This is a machine endpoint, not a page.</strong>
        It answers the OAI-PMH protocol, which requires a <code>verb</code> argument;
        without one it must reply with an error. Nothing is broken — pick a verb below.
      </p>
      <p class="note">
        Server said: <code><xsl:value-of select="@code" /></code> —
        <xsl:value-of select="." />
      </p>
    </div>
  </xsl:template>

  <xsl:template match="oai:Identify">
    <h2>Identify</h2>
    <dl>
      <dt>Repository</dt><dd><xsl:value-of select="oai:repositoryName" /></dd>
      <dt>Base URL</dt><dd><xsl:value-of select="oai:baseURL" /></dd>
      <dt>Protocol</dt><dd><xsl:value-of select="oai:protocolVersion" /></dd>
      <dt>Admin</dt>
      <dd>
        <xsl:for-each select="oai:adminEmail">
          <a href="mailto:{.}"><xsl:value-of select="." /></a>
          <xsl:if test="position() != last()">, </xsl:if>
        </xsl:for-each>
      </dd>
      <dt>Earliest</dt><dd><xsl:value-of select="oai:earliestDatestamp" /></dd>
      <dt>Granularity</dt><dd><xsl:value-of select="oai:granularity" /></dd>
      <dt>Deleted</dt><dd><xsl:value-of select="oai:deletedRecord" /></dd>
    </dl>
  </xsl:template>

  <xsl:template match="oai:ListMetadataFormats">
    <h2>Metadata formats</h2>
    <ol>
      <xsl:for-each select="oai:metadataFormat">
        <li>
          <span class="rec-title mono"><xsl:value-of select="oai:metadataPrefix" /></span>
          <span class="rec-meta"><xsl:value-of select="oai:schema" /></span>
        </li>
      </xsl:for-each>
    </ol>
  </xsl:template>

  <xsl:template match="oai:ListSets">
    <h2>Sets</h2>
    <ol>
      <xsl:for-each select="oai:set">
        <li>
          <span class="rec-title"><xsl:value-of select="oai:setName" /></span>
          <span class="rec-meta">
            <a href="?verb=ListRecords&amp;metadataPrefix=oai_dc&amp;set={oai:setSpec}">
              <xsl:value-of select="oai:setSpec" />
            </a>
          </span>
        </li>
      </xsl:for-each>
    </ol>
  </xsl:template>

  <xsl:template match="oai:ListIdentifiers">
    <h2>Identifiers</h2>
    <ol>
      <xsl:for-each select="oai:header">
        <li>
          <span class="rec-title mono">
            <a href="?verb=GetRecord&amp;metadataPrefix=oai_dc&amp;identifier={oai:identifier}">
              <xsl:value-of select="oai:identifier" />
            </a>
          </span>
          <span class="rec-meta"><xsl:value-of select="oai:datestamp" /></span>
        </li>
      </xsl:for-each>
    </ol>
    <xsl:apply-templates select="oai:resumptionToken" />
  </xsl:template>

  <xsl:template match="oai:ListRecords">
    <h2>Records</h2>
    <ol>
      <xsl:apply-templates select="oai:record" />
    </ol>
    <xsl:apply-templates select="oai:resumptionToken" />
  </xsl:template>

  <xsl:template match="oai:GetRecord">
    <h2>Record</h2>
    <ol>
      <xsl:apply-templates select="oai:record" />
    </ol>
  </xsl:template>

  <xsl:template match="oai:record">
    <li>
      <span class="rec-title">
        <xsl:variable name="url" select=".//dc:identifier[starts-with(., 'http')][1]" />
        <xsl:choose>
          <xsl:when test="$url">
            <a href="{$url}"><xsl:value-of select=".//dc:title[1]" /></a>
          </xsl:when>
          <xsl:otherwise><xsl:value-of select=".//dc:title[1]" /></xsl:otherwise>
        </xsl:choose>
      </span>
      <span class="rec-meta">
        <xsl:for-each select=".//dc:creator">
          <xsl:value-of select="." />
          <xsl:if test="position() != last()">; </xsl:if>
        </xsl:for-each>
        <xsl:if test=".//dc:date"> · <xsl:value-of select=".//dc:date[1]" /></xsl:if>
        <xsl:text> · </xsl:text>
        <xsl:value-of select="oai:header/oai:identifier" />
      </span>
    </li>
  </xsl:template>

  <xsl:template match="oai:resumptionToken">
    <xsl:if test="string-length(.) &gt; 0">
      <p class="note">
        Showing part of <xsl:value-of select="@completeListSize" /> records
        (cursor <xsl:value-of select="@cursor" />) ·
        <a href="?verb={name(..)}&amp;resumptionToken={.}">next page</a>
      </p>
    </xsl:if>
  </xsl:template>

  <xsl:template name="verbs">
    <h2>Verbs</h2>
    <ol>
      <li><a href="?verb=Identify">Identify</a><span class="rec-meta">who this repository is</span></li>
      <li><a href="?verb=ListMetadataFormats">ListMetadataFormats</a><span class="rec-meta">formats on offer</span></li>
      <li><a href="?verb=ListSets">ListSets</a><span class="rec-meta">subject sets you can filter by</span></li>
      <li><a href="?verb=ListIdentifiers&amp;metadataPrefix=oai_dc">ListIdentifiers</a><span class="rec-meta">record ids only</span></li>
      <li><a href="?verb=ListRecords&amp;metadataPrefix=oai_dc">ListRecords</a><span class="rec-meta">full Dublin Core records</span></li>
    </ol>
    <p class="note">
      Harvesting the whole archive means following <code>resumptionToken</code> through
      every page of <code>ListRecords</code>. Questions:
      <a href="mailto:editor@jcrt.org">editor@jcrt.org</a>.
    </p>
  </xsl:template>

</xsl:stylesheet>
