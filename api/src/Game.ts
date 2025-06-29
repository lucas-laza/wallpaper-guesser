import {
  BaseEntity,
  Column,
  Entity,
  JoinTable,
  ManyToMany,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { User } from "./User";
import { Party } from "./Party";

// Enum definitions
export enum GameStatus {
  PENDING = "pending",
  IN_PROGRESS = "in_progress",
  ABORTED = "aborted",
  COMPLETED = "completed",
}

export enum GameMode {
  STANDARD = "standard",
}

@Entity()
export class Game extends BaseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => Party, { nullable: true, onDelete: "SET NULL" })
  party!: Party | null;

  @ManyToMany(() => User)
  @JoinTable()  // Keep @JoinTable() here in Game (Only one side should have @JoinTable)
  players!: User[];

  @Column({
    type: "varchar",  
    length: 20,  
    default: GameStatus.PENDING,
  })
  status!: GameStatus;

  @Column({
    type: "varchar",  
    length: 20,  
    default: GameMode.STANDARD,
  })
  gamemode!: GameMode;

  @Column()
  map!: string;

  @Column({ default: 3, nullable: false, unsigned: true })
  rounds_number!: number;

  @Column({ type: "json", nullable: true })
  modifiers!: object | null;

  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  winner!: User | null;

  @Column()
  time!: number;
}
