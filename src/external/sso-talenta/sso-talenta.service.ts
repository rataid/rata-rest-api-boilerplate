import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';
import { catchError, firstValueFrom, retry, timeout } from 'rxjs';
import { SsoTalentaUserResponse } from './dto/sso-talenta.dto';

@Injectable()
export class SsoTalentaService {
  private readonly logger = new Logger(SsoTalentaService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    this.baseUrl = this.config.getOrThrow<string>('ssoTalenta.baseUrl');
    this.apiKey = this.config.getOrThrow<string>('ssoTalenta.apiKey');
  }

  async getUserByEmail(email: string): Promise<SsoTalentaUserResponse> {
    const { data } = await firstValueFrom(
      this.http
        .post<SsoTalentaUserResponse>(
          `${this.baseUrl}/users/lookup`,
          { email },
          { headers: { 'X-Api-Key': this.apiKey } },
        )
        .pipe(
          timeout(5000),
          retry(2),
          catchError((error: AxiosError) => {
            this.logger.error(
              `SSOTalenta lookup failed for ${email}: ${error.message}`,
            );
            throw new ServiceUnavailableException(
              'SSOTalenta service is unreachable',
            );
          }),
        ),
    );

    return data;
  }
}
