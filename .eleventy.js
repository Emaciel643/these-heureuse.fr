import Profiler from '11ty-fx-profiler';
import moment from 'moment';
import fs from 'fs';
import zlib from 'zlib';
import CleanCSS from "clean-css";
import {PurgeCSS} from "purgecss";
import purgeHtml from "purgecss-from-html";
import htmlmin from "html-minifier";
import Image from "@11ty/eleventy-img";
import UglifyJS from "uglify-js";
import pluginRss from "@11ty/eleventy-plugin-rss";

moment.locale('fr');

const nbsp = "&nbsp;";

var UserBenchmarks;

async function image(src, alt, sizes, width, lazy = true) {
  const b = UserBenchmarks.get("> image > " + src + (width ? " (" + width + "px)" : ""));
  b.before();

  const imageOptions = {
    formats: ["avif", "jpeg", "svg"],
    svgShortCircuit: true,
    outputDir: "./_site/img/"
  };
  if (width) {
    imageOptions.widths = [width];
  }
  let metadata = await Image(src, imageOptions);

  let imageAttributes = {
    alt,
    sizes,
  };
  if (lazy) {
    imageAttributes.loading = "lazy";
    imageAttributes.decoding =  "async";
  } else {
    imageAttributes.decoding =  "sync";
  }

  // You bet we throw an error on a missing alt (alt="" works okay)
  let rv = Image.generateHTML(metadata, imageAttributes);

  b.after();
  return rv;
}

export default function (eleventyConfig) {
  Profiler(eleventyConfig);
  // Start the category name with a space so it sorts before "Aggregate".
  UserBenchmarks = eleventyConfig.benchmarkManager.get(" User");

  eleventyConfig.setServerPassthroughCopyBehavior("passthrough");
  eleventyConfig.addPassthroughCopy("CNAME");
  eleventyConfig.addPassthroughCopy("fonts");
  eleventyConfig.addPassthroughCopy("img");

  eleventyConfig.addCollection("testsAndPosts", function testsAndPostsCollection(collectionApi) {
    return collectionApi.getFilteredByGlob(["posts/*.md", "tests/*.md"]);
  });

  eleventyConfig.addPlugin(pluginRss);

  const fullCss = fs.readFileSync("_includes/theme.css", {
    encoding: "utf-8",
  });
  eleventyConfig.addTransform("htmlmin", async function htmlMinTransform(content) {
    // Prior to Eleventy 2.0: use this.outputPath instead
    if (this.page.outputPath && this.page.outputPath.endsWith(".html")) {
      const b = UserBenchmarks.get("> htmlmin > " + this.page.outputPath);
      b.before();

      content = content.replace(/ ([!?:;»])/g, nbsp + "$1")
        .replace(/« /g, "«" + nbsp)
        .replace(/([^-].)'/g, "$1’") // avoid replacing ' in urls where spaces are replaced with -.
        .replace(/oe/g, "œ")
        .replace(/\.\.\./g, "…");

      let bCss = UserBenchmarks.get("> htmlmin > PurgeCSS: " + this.page.outputPath);
      bCss.before();

      let purgeResult = await new PurgeCSS().purge({
        extractors: [
          {
            extractor: purgeHtml,
            extensions: ["html"],
          },
        ],
        content: [
          {
            raw: content,
            extension: "html",
          },
        ],
        css: [
          {
            raw: fullCss,
          },
        ],
      });
      bCss.after();

      const cleanCss = new CleanCSS({}).minify(purgeResult[0].css).styles;
      content = content.replace("</head>", `<style>${cleanCss}</style></head>`);

      if (!process.env.NO_MINIFY) {
        content = htmlmin.minify(content, {
          removeComments: true,
          collapseWhitespace: true,
        });
      }

      b.after();
    }

    return content;
  });

  eleventyConfig.addFilter("limit", function(array, limit) {
    return array.slice(0, limit);
  });

  eleventyConfig.addFilter('trim', string => {
    return string.trim();
  });

  eleventyConfig.addFilter('dateIso', date => {
    return moment(date).toISOString();
  });

  eleventyConfig.addFilter('dateReadable', date => {
    return moment(date).utc().format('LL'); // E.g. May 31, 2019
  });

  eleventyConfig.addFilter("cssmin", function(code) {
    return new CleanCSS({}).minify(code).styles;
  });

  eleventyConfig.addFilter("jsmin", function jsmin(code) {
    let minified = UglifyJS.minify(code);
    if (minified.error) {
      console.log("UglifyJS error: ", minified.error);
      return code;
    }

    return minified.code;
  });

  // Used for meta og:image and twitter:image
  eleventyConfig.addShortcode("img", async function(src) {
    const b = UserBenchmarks.get("> img > " + src);
    b.before();

    const imageOptions = {
      formats: ["jpeg"],
      outputDir: "./_site/img/",
      widths: [800],
    };

    let metadata = await Image("./images/" + src, imageOptions);

    b.after();
    return metadata.jpeg[0].url;
  });

  eleventyConfig.addShortcode("image", async function(src, alt, sizes, width, lazy = true) {
    return image(src, alt, sizes, width, lazy);
  });

  eleventyConfig.addPairedShortcode("intro", async function(content, filename, alt) {
    let img = await image("./images/" + filename, alt, "512w", 512, false);
    return `<div id="intro"><div>${content}</div>${img}</div>`;
  });

  eleventyConfig.addPairedShortcode("tldr", function(content, title="En résumé") {
    return `<div id="tldr"><h2>${title}</h2>\n${content}</div>`;
  });

  eleventyConfig.addPairedShortcode("plusloin", function(content, title="Pour aller plus loin") {
    return `<div id="plusloin"><h2>${title}</h2>\n${content}</div>`;
  });

  eleventyConfig.addLiquidTag("test", function (liquidEngine) {
    return {
      parse(tagToken, remainingTokens = []) {
        let input = tagToken.args;
        let index = input.indexOf(" ");
        if (index != -1) {
          this.slug = input.slice(0, index);
          this.label = input.slice(index + 1);
        } else {
          this.slug = input;
        }
      },
      async render(ctx) {
        const tests = ctx.environments.collections.test;
        const test = tests.find(t => t.fileSlug == this.slug);
        if (!test) {
          throw new Error(`No ${this.slug} test`);
        }
        if (this.label) {
          return `[${this.label}](${test.url} "${test.data.pagetitle}")`;
        }

        return test.url;
      },
    };
  });

  eleventyConfig.addLiquidTag("post", function (liquidEngine) {
    return {
      parse(tagToken, remainingTokens = []) {
        let input = tagToken.args;
        let index = input.indexOf(" ");
        if (index != -1) {
          this.slug = input.slice(0, index);
          this.label = input.slice(index + 1);
        } else {
          this.slug = input;
        }
      },
      async render(ctx) {
        const posts = ctx.environments.collections.post;
        const post = posts.find(t => t.fileSlug == this.slug);
        if (!post) {
          throw new Error(`No ${this.slug} article`);
        }
        if (this.label) {
          return `[${this.label}](${post.url} "${post.data.pagetitle}")`;
        }

        return post.url;
      },
    };
  });

  eleventyConfig.setFrontMatterParsingOptions({
    excerpt: true,
    // Optional, default is "---"
    excerpt_separator: "<!-- excerpt -->"
  });
}
