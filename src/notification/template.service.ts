import { Injectable, InternalServerErrorException } from '@nestjs/common';
import * as fs from 'fs';
import * as Handlebars from 'handlebars';
import { join } from 'path';

@Injectable()
export class TemplateService {
  private readonly templatesDir = join(__dirname, 'templates');
  private readonly compiledCache = new Map<string, Handlebars.TemplateDelegate>();

  render(templateName: string, context: Record<string, unknown>): string {
    const compiled = this.getCompiledTemplate(templateName);
    return compiled(context);
  }

  private getCompiledTemplate(templateName: string): Handlebars.TemplateDelegate {
    const cached = this.compiledCache.get(templateName);
    if (cached) return cached;

    const filePath = join(this.templatesDir, `${templateName}.hbs`);

    if (!fs.existsSync(filePath)) {
      throw new InternalServerErrorException(
        `Notification template "${templateName}" not found`,
      );
    }

    const source = fs.readFileSync(filePath, 'utf-8');
    const compiled = Handlebars.compile(source);
    this.compiledCache.set(templateName, compiled);

    return compiled;
  }
}
