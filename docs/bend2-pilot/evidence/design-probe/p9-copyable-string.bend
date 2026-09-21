import Base

law twice:
  for +s: String
  String

def twice(s):
  String.append(s, s)

law main:
  IO(Unit)

def main():
  do IO<Unit>:
    IO.print(twice("ab"))
