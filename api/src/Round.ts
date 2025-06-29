import {
  BaseEntity,
  Column,
  Entity,
  ManyToOne,
  ManyToMany,
  JoinTable,
  PrimaryGeneratedColumn,
} from "typeorm";
import { Game } from "./Game";
import { User } from "./User";
import { Wallpaper } from "./Wallpaper";
import { Party } from "./Party";

@Entity()
export class Round extends BaseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => Game, { nullable: false })
  game!: Game;

  @ManyToOne(() => Party, { nullable: true })
  party!: Party | null;

  @ManyToMany(() => User)
  @JoinTable({
    name: "round_players",
    joinColumn: {
      name: "round_id",
      referencedColumnName: "id"
    },
    inverseJoinColumn: {
      name: "user_id",
      referencedColumnName: "id"
    }
  })
  players!: User[];

  @ManyToOne(() => Wallpaper, { nullable: false })
  wallpaper!: Wallpaper;

  @Column({ nullable: false, default: 0 })
  guesses!: number;

  @Column({ nullable: false })
  relative_id!: number;
}