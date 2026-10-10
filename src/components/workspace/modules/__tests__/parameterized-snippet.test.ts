import { describe, expect, it } from "vitest";
import {
  extractSnippetParams,
  interpolateSnippet,
} from "../parameterized-snippet-dialog";

describe("parameterized snippet utilities", () => {
  it("extracts placeholders without default values", () => {
    const template = "ping {{host}} -c {{count}}";
    const params = extractSnippetParams(template);
    expect(params).toHaveLength(2);
    expect(params[0]).toEqual({
      key: "host",
      raw: "{{host}}",
      label: "host",
      defaultValue: "",
    });
    expect(params[1]).toEqual({
      key: "count",
      raw: "{{count}}",
      label: "count",
      defaultValue: "",
    });
  });

  it("extracts placeholders with default values using colon", () => {
    const template = "docker logs -f --tail={{tail:100}} {{container:nginx}}";
    const params = extractSnippetParams(template);
    expect(params).toHaveLength(2);
    expect(params[0].key).toBe("tail");
    expect(params[0].defaultValue).toBe("100");
    expect(params[1].key).toBe("container");
    expect(params[1].defaultValue).toBe("nginx");
  });

  it("handles duplicate placeholders cleanly", () => {
    const template = "cp {{file}} {{file}}.bak";
    const params = extractSnippetParams(template);
    expect(params).toHaveLength(1);
    expect(params[0].key).toBe("file");
  });

  it("interpolates values correctly with user inputs", () => {
    const template = "curl -X POST https://{{host}}:{{port:443}}/api/{{endpoint}}";
    const values = {
      host: "example.com",
      endpoint: "users",
    };
    const result = interpolateSnippet(template, values);
    expect(result).toBe("curl -X POST https://example.com:443/api/users");
  });

  it("falls back to default values when user inputs are empty", () => {
    const template = "tar -czvf {{archive:backup.tar.gz}} {{source}}";
    const values = {
      archive: "",
      source: "/var/log",
    };
    const result = interpolateSnippet(template, values);
    expect(result).toBe("tar -czvf backup.tar.gz /var/log");
  });

  it("keeps raw placeholder if no default and no value", () => {
    const template = "ssh {{user}}@{{host}}";
    const values = {
      user: "root",
    };
    const result = interpolateSnippet(template, values);
    expect(result).toBe("ssh root@{{host}}");
  });
});
