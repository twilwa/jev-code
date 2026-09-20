import Base

law loop:
  for n: Nat
  for +acc: U32
  U32

def loop(n, acc):
  match n:
    case 0n:
      acc
    case 1n+m:
      loop(m, U32.add(acc, 1))

law main:
  IO(Unit)

def main():
  do IO<Unit>:
    IO.print(U32.show(loop(5n, 0)))
