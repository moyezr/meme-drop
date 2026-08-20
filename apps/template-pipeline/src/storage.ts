import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";

import type { DownloadedImage } from "./image.js";
import type { PipelineConfig } from "./config.js";
import type { ScrapedTemplate, StoredAsset } from "./types.js";

export class DevelopmentTemplateStorage {
  readonly bucket: "meme-drop-dev";
  private readonly client: S3Client;

  constructor(config: PipelineConfig, client?: S3Client) {
    if (config.bucket !== "meme-drop-dev") throw new Error("Template media must use meme-drop-dev");
    this.bucket = config.bucket;
    const clientConfig: S3ClientConfig = {
      endpoint: config.s3Endpoint,
      region: config.s3Region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.s3AccessKeyId,
        secretAccessKey: config.s3SecretAccessKey,
      },
    };
    this.client = client || new S3Client(clientConfig);
  }

  async putIfAbsent(template: ScrapedTemplate, image: DownloadedImage): Promise<StoredAsset> {
    const objectKey = `catalog/scraped/imgflip/${template.source_id}-${image.content_sha256.slice(0, 12)}.${image.extension}`;
    if (!(await this.exists(objectKey))) {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: objectKey,
          Body: image.bytes,
          ContentType: image.mime_type,
          Metadata: {
            source: "imgflip",
            source_id: template.source_id,
            sha256: image.content_sha256,
          },
        }),
      );
    }
    return {
      bucket: this.bucket,
      object_key: objectKey,
      public_path: `/memes/${objectKey}`,
      content_sha256: image.content_sha256,
      mime_type: image.mime_type,
      byte_size: image.bytes.length,
      width: image.width,
      height: image.height,
    };
  }

  private async exists(objectKey: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }));
      return true;
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      const name = (error as { name?: string }).name;
      if (status === 404 || name === "NotFound" || name === "NoSuchKey") return false;
      throw error;
    }
  }
}
