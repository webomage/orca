export type FileDocument = {
  filePath: string
  relativePath: string
  basename: string
  name: string
  aliases?: string[]
}

export type MarkdownDocument = FileDocument
