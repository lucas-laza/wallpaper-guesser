import {
  BaseEntity,
  Column,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { User } from "./User";
import { Round } from "./Round";
import { Game } from "./Game";
import { Party } from "./Party";

@Entity()
export class Guess extends BaseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => User, { nullable: false })
  user!: User;

  @ManyToOne(() => Round, { nullable: false })
  round!: Round;

  @ManyToOne(() => Game, { nullable: false })
  game!: Game;

  @ManyToOne(() => Party, { nullable: false })
  party!: Party;

  @Column({ nullable: false })
  country_code!: string;

  @Column({ nullable: false })
  is_correct!: boolean;
}
