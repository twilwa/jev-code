import Base

law main.go:
  for +x: U32
  IO(Unit)

def main.go(x):
  do IO<Unit>:
    IO.print(U32.show(U32.add(x, x)))

law main:
  IO(Unit)

def main():
  main.go(21)
