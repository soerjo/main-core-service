import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ClientCredentialsDto {
  @ApiProperty({ example: 'grantType' })
  @IsString()
  @IsNotEmpty()
  grantType: string;

  @ApiProperty({ example: 'uuid-client-id' })
  @IsString()
  @IsNotEmpty()
  clientId: string;

  @ApiProperty({ example: 'plain-text-secret' })
  @IsString()
  @IsNotEmpty()
  clientSecret: string;
}
