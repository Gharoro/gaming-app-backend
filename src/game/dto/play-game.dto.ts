import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class PlayGameDto {
  @ApiProperty({
    description: 'Game session ID',
    example: '0e1aaa46-ce1a-40c8-b7ae-116638c574df',
  })
  @IsString()
  @IsNotEmpty({ message: 'Game session ID is required' })
  gameSessionId: string;

  @ApiProperty({
    description: 'Selected number',
    example: 5,
  })
  @IsNumber()
  @IsNotEmpty({ message: 'Selected number is required' })
  selectedNumber: number;
}
